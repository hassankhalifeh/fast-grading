-- =====================================================================
-- 09_submission_lock_and_reassignment.sql
-- قفل اعتماد نهائي على مستوى الامتحان (الناظر) + آلية نقل علامة مُدخلة
-- بالغلط تحت امتحان خاطئ لامتحانها الصحيح، مسموحة فقط قبل الاعتماد النهائي
--
-- مصحَّح ليطابق capabilities.key و audit_logs الحقيقية (account_id
-- إلزامي، action_type من ENUM محدود، old/new_value JSONB)
-- =====================================================================

INSERT INTO capabilities (key, label_ar, category)
VALUES ('grades.finalize_submission', 'اعتماد العلامات نهائياً لامتحان معيّن (قفل) أو إعادة فتحها للتصحيح', 'Admin')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_locked_by_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES app_users(id);
ALTER TABLE exams ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION enforce_grades_admin_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_locked BOOLEAN;
    v_exam_id UUID;
BEGIN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
    SELECT is_locked_by_admin INTO v_locked FROM exams WHERE id = v_exam_id;

    IF v_locked THEN
        RAISE EXCEPTION 'تم اعتماد علامات هاد الامتحان نهائياً من الناظر - يلزم إعادة فتح الاعتماد أولاً قبل أي تعديل';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_grades_admin_lock
    BEFORE INSERT OR UPDATE OR DELETE ON grades
    FOR EACH ROW EXECUTE FUNCTION enforce_grades_admin_lock();

CREATE OR REPLACE FUNCTION finalize_exam_submission(p_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_account_id UUID;
BEGIN
    UPDATE exams SET is_locked_by_admin = true, locked_by = p_actor_id, locked_at = now()
    WHERE id = p_exam_id
    RETURNING account_id INTO v_account_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'exams',
            jsonb_build_object('event', 'exam_grades_finalized', 'exam_id', p_exam_id));

    RETURN 'تم اعتماد علامات الامتحان نهائياً - الإدخال والتعديل مقفولان الآن';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reopen_exam_submission(p_exam_id UUID, p_actor_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    v_account_id UUID;
BEGIN
    UPDATE exams SET is_locked_by_admin = false, locked_by = NULL, locked_at = NULL
    WHERE id = p_exam_id
    RETURNING account_id INTO v_account_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'exams',
            jsonb_build_object('event', 'exam_grades_reopened', 'exam_id', p_exam_id, 'reason', p_reason));

    RETURN 'تم إعادة فتح الامتحان للتعديل';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reassign_grades_to_exam(
    p_student_ids UUID[],
    p_from_exam_id UUID,
    p_to_exam_id UUID,
    p_actor_id UUID
)
RETURNS TEXT AS $$
DECLARE
    v_from_locked BOOLEAN;
    v_to_locked BOOLEAN;
    v_conflict_count INTEGER;
    v_moved_count INTEGER;
    v_account_id UUID;
BEGIN
    SELECT is_locked_by_admin, account_id INTO v_from_locked, v_account_id FROM exams WHERE id = p_from_exam_id;
    SELECT is_locked_by_admin INTO v_to_locked FROM exams WHERE id = p_to_exam_id;

    IF v_from_locked OR v_to_locked THEN
        RAISE EXCEPTION 'لا يمكن نقل العلامات - أحد الامتحانين (المصدر أو الهدف) معتمد نهائياً من الناظر';
    END IF;

    SELECT count(*) INTO v_conflict_count
    FROM grades g_from
    JOIN grades g_to ON g_to.exam_id = p_to_exam_id
                     AND g_to.student_id = g_from.student_id
                     AND g_to.component_id IS NOT DISTINCT FROM g_from.component_id
    WHERE g_from.exam_id = p_from_exam_id
      AND g_from.student_id = ANY(p_student_ids);

    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'يوجد % طالب عندهم أصلاً علامة بالامتحان الهدف - استخدم شاشة حل التعارض (apply_grade_entry) لهاد الحالات بدل النقل المباشر', v_conflict_count;
    END IF;

    UPDATE grades
    SET exam_id = p_to_exam_id
    WHERE exam_id = p_from_exam_id
      AND student_id = ANY(p_student_ids);

    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, old_value, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'grades',
            jsonb_build_object('event', 'grades_reassigned_to_correct_exam', 'from_exam_id', p_from_exam_id),
            jsonb_build_object('to_exam_id', p_to_exam_id, 'students_moved', v_moved_count));

    RETURN format('تم نقل علامات %s طالب من الامتحان الخاطئ للامتحان الصحيح', v_moved_count);
END;
$$ LANGUAGE plpgsql;

-- ملاحظة تدفق العمل الكاملة:
-- 1) الناظر يفتح نافذة العلامات → المعلمون يدخلون
-- 2) طول ما الامتحان is_locked_by_admin = false، أي تصحيح حر:
--    - تعديل رقم عادي → apply_grade_entry (08)
--    - العلامة صارت تحت امتحان غلط بالكامل → reassign_grades_to_exam (هاد الملف)
-- 3) لما ينتهي المعلمون، الناظر يراجع ويعمل finalize_exam_submission → قفل تام
-- 4) أي خطأ يُكتشف بعد الاعتماد يتطلب reopen_exam_submission أولاً
-- =====================================================================
