-- =====================================================================
-- 10_graduated_lock_tiers.sql
-- تطوير قفل الاعتماد من 09 (ثنائي: مقفول/مفتوح) إلى قفل متدرّج بمستويات
-- تطابق تسلسل الصلاحيات: الناظر العام → مساعد الناظر → الأستاذ
--
-- مصحَّح: capabilities.key، has_capability(p_code) بوسيط واحد (تتحقق
-- من جلسة auth.uid() الحالية مباشرة - v_actor_id هنا هو دائماً نفس
-- المستخدم صاحب الجلسة وقت إطلاق التريغر، فالنتيجة مطابقة)، audit_logs
-- بالشكل الحقيقي (account_id + ENUM + table_name + JSONB)
-- =====================================================================

-- 0) تفسير المستويات (lock_tier على exams):
--    2 = قفل كامل نهائي   → الكتابة مسموحة فقط لمن يملك grades.finalize_submission
--    1 = قفل جزئي         → الكتابة مسموحة لمن يملك grades.enter_privileged فأعلى
--    0 = مفتوح بالكامل    → الكتابة مسموحة لمن يملك grades.enter فأعلى (الوضع الطبيعي)

INSERT INTO capabilities (key, label_ar, category)
VALUES ('grades.enter_privileged', 'إدخال/تعديل العلامات أثناء وجود قفل جزئي من الناظر العام (طبقة مساعد الناظر)', 'Grades')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS lock_tier SMALLINT NOT NULL DEFAULT 0
    CHECK (lock_tier IN (0, 1, 2));

UPDATE exams SET lock_tier = 2 WHERE is_locked_by_admin = true AND lock_tier = 0;

CREATE OR REPLACE FUNCTION get_actor_grade_authority_tier(p_actor_id UUID)
RETURNS SMALLINT AS $$
BEGIN
    IF has_capability('grades.finalize_submission') THEN
        RETURN 2;
    ELSIF has_capability('grades.enter_privileged') THEN
        RETURN 1;
    ELSIF has_capability('grades.enter') THEN
        RETURN 0;
    ELSE
        RETURN -1;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION enforce_grades_admin_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_exam_id UUID;
    v_lock_tier SMALLINT;
    v_actor_tier SMALLINT;
    v_actor_id UUID := current_app_user_id();
BEGIN
    v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
    SELECT lock_tier INTO v_lock_tier FROM exams WHERE id = v_exam_id;
    v_actor_tier := get_actor_grade_authority_tier(v_actor_id);

    IF v_actor_tier < v_lock_tier THEN
        RAISE EXCEPTION 'هاد الامتحان مقفول حالياً بمستوى أعلى من صلاحيتك - يلزم أن يرفع الناظر العام القفل درجة قبل ما تقدر تعدّل';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- التريغر trg_enforce_grades_admin_lock من 09 يستخدم هالدالة تلقائياً (نفس الاسم)

CREATE OR REPLACE FUNCTION finalize_exam_submission(p_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_account_id UUID;
BEGIN
    UPDATE exams SET lock_tier = 2, is_locked_by_admin = true, locked_by = p_actor_id, locked_at = now()
    WHERE id = p_exam_id
    RETURNING account_id INTO v_account_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'exams',
            jsonb_build_object('event', 'exam_grades_finalized', 'exam_id', p_exam_id, 'lock_tier', 2));

    RETURN 'تم اعتماد علامات الامتحان نهائياً - مقفول بالكامل حتى على مساعد الناظر';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lower_exam_lock_tier(p_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_current SMALLINT;
    v_new SMALLINT;
    v_account_id UUID;
BEGIN
    SELECT lock_tier, account_id INTO v_current, v_account_id FROM exams WHERE id = p_exam_id;

    IF v_current = 0 THEN
        RETURN 'الامتحان مفتوح بالكامل أصلاً - ما في قفل لرفعه';
    END IF;

    v_new := v_current - 1;

    UPDATE exams
    SET lock_tier = v_new,
        is_locked_by_admin = (v_new > 0),
        locked_by = CASE WHEN v_new = 0 THEN NULL ELSE locked_by END,
        locked_at = CASE WHEN v_new = 0 THEN NULL ELSE locked_at END
    WHERE id = p_exam_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, old_value, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'exams',
            jsonb_build_object('previous_tier', v_current),
            jsonb_build_object('event', 'exam_lock_tier_lowered', 'exam_id', p_exam_id, 'new_tier', v_new));

    RETURN CASE
        WHEN v_new = 1 THEN 'تم رفع القفل درجة - مساعد الناظر فأعلى يقدر يعدّل الآن (الأستاذ لسا ممنوع)'
        ELSE 'تم رفع القفل بالكامل - الأستاذ يقدر يعدّل الآن كالمعتاد'
    END;
END;
$$ LANGUAGE plpgsql;

-- reopen_exam_submission من 09 تبقى موجودة كخيار "فتح فوري كامل" (طوارئ،
-- يقفز مباشرة لتير 0 بضغطة وحدة) - lower_exam_lock_tier هي المسار التدريجي
CREATE OR REPLACE FUNCTION reopen_exam_submission(p_exam_id UUID, p_actor_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    v_account_id UUID;
BEGIN
    UPDATE exams SET lock_tier = 0, is_locked_by_admin = false, locked_by = NULL, locked_at = NULL
    WHERE id = p_exam_id
    RETURNING account_id INTO v_account_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'exams',
            jsonb_build_object('event', 'exam_grades_reopened_fully', 'exam_id', p_exam_id, 'reason', p_reason));

    RETURN 'تم فتح الامتحان بالكامل فوراً (تجاوز التدرّج)';
END;
$$ LANGUAGE plpgsql;
-- =====================================================================
