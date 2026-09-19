-- =====================================================================
-- 27_lock_and_import_hardening.sql
-- تحضير القاعدة لواجهات الاستيراد الجماعي وحل التعارض والقفل. دوال 07-10 كانت
-- تعتمد على "التحقق بطبقة التطبيق" فبنسدّها بالقاعدة نفسها:
--  * القفل (finalize/lower/reopen): صلاحية grades.finalize_submission ضمن نطاق
--    الشعبة، وتغيير أعمدة القفل مباشرة على exams ممنوع (عبر الدوال فقط).
--  * مستوى سلطة الكاتب على العلامات يُحسب ضمن نطاق شعبة الامتحان (نظّار مقيّدون).
--  * apply_grade_entry / reassign_grades_to_exam: تحقق حساب وهوية ونطاق.
--  * الاستيراد: commit للطلاب يدخل بيانات ولي الأمر ويسجّل الطالب بالصف ويتحقق
--    من الصلاحية والحالة؛ + استيراد الصفوف.
--  * window.toggle ضمن نطاق ناظر المرحلة/المساعد وليس أدوار الإدارة فقط.
-- =====================================================================

-- 1) حارس أعمدة القفل: لا تغيير مباشر، فقط عبر الدوال (تضبط app.lock_change)
CREATE OR REPLACE FUNCTION guard_exam_lock_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF ROW(NEW.lock_tier, NEW.is_locked_by_admin, NEW.locked_by, NEW.locked_at)
       IS DISTINCT FROM ROW(OLD.lock_tier, OLD.is_locked_by_admin, OLD.locked_by, OLD.locked_at)
       AND COALESCE(current_setting('app.lock_change', true), '') <> '1' THEN
        RAISE EXCEPTION 'قفل الاعتماد يتغير عبر دوال الاعتماد/رفع القفل فقط';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_guard_exam_lock_columns
    BEFORE UPDATE ON exams
    FOR EACH ROW EXECUTE FUNCTION guard_exam_lock_columns();

-- 2) سلطة الكاتب على علامات امتحان معيّن (ضمن نطاق شعبته)
CREATE OR REPLACE FUNCTION actor_exam_tier(p_exam UUID)
RETURNS SMALLINT AS $$
DECLARE v_class UUID;
BEGIN
    SELECT class_section_id INTO v_class FROM exams WHERE id = p_exam;
    IF has_capability_in('grades.finalize_submission', NULL, v_class, NULL) THEN RETURN 2;
    ELSIF has_capability_in('grades.enter_privileged', NULL, v_class, NULL) THEN RETURN 1;
    ELSIF has_capability_in('grades.enter', NULL, v_class, NULL) THEN RETURN 0;
    END IF;
    RETURN -1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION enforce_grades_admin_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_exam_id UUID := COALESCE(NEW.exam_id, OLD.exam_id);
    v_lock_tier SMALLINT;
BEGIN
    SELECT lock_tier INTO v_lock_tier FROM exams WHERE id = v_exam_id;
    IF actor_exam_tier(v_exam_id) < v_lock_tier THEN
        RAISE EXCEPTION 'هاد الامتحان مقفول حالياً بمستوى أعلى من صلاحيتك - يلزم أن يرفع الناظر العام القفل درجة قبل ما تقدر تعدّل';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 3) دوال القفل بتحقق داخلي
CREATE OR REPLACE FUNCTION finalize_exam_submission(p_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE v_me UUID := current_app_user_id(); v_acc UUID; v_class UUID;
BEGIN
    IF p_actor_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT account_id, class_section_id INTO v_acc, v_class FROM exams WHERE id = p_exam_id;
    IF v_acc IS DISTINCT FROM current_account_id() THEN RAISE EXCEPTION 'الامتحان غير موجود'; END IF;
    IF NOT has_capability_in('grades.finalize_submission', NULL, v_class, NULL) THEN
        RAISE EXCEPTION 'اعتماد العلامات نهائياً يتطلب الصلاحية grades.finalize_submission';
    END IF;
    PERFORM set_config('app.lock_change', '1', true);
    UPDATE exams SET lock_tier = 2, is_locked_by_admin = true, locked_by = v_me, locked_at = now() WHERE id = p_exam_id;
    PERFORM set_config('app.lock_change', '', true);
    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_acc, v_me, 'update', 'exams', p_exam_id, jsonb_build_object('event', 'exam_grades_finalized', 'lock_tier', 2));
    RETURN 'تم اعتماد علامات الامتحان نهائياً - مقفول بالكامل حتى على مساعد الناظر';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION lower_exam_lock_tier(p_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE v_me UUID := current_app_user_id(); v_acc UUID; v_class UUID; v_current SMALLINT; v_new SMALLINT;
BEGIN
    IF p_actor_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT account_id, class_section_id, lock_tier INTO v_acc, v_class, v_current FROM exams WHERE id = p_exam_id;
    IF v_acc IS DISTINCT FROM current_account_id() THEN RAISE EXCEPTION 'الامتحان غير موجود'; END IF;
    IF NOT has_capability_in('grades.finalize_submission', NULL, v_class, NULL) THEN
        RAISE EXCEPTION 'رفع القفل يتطلب الصلاحية grades.finalize_submission';
    END IF;
    IF v_current = 0 THEN RETURN 'الامتحان مفتوح بالكامل أصلاً - ما في قفل لرفعه'; END IF;
    v_new := v_current - 1;
    PERFORM set_config('app.lock_change', '1', true);
    UPDATE exams SET lock_tier = v_new, is_locked_by_admin = (v_new > 0),
        locked_by = CASE WHEN v_new = 0 THEN NULL ELSE locked_by END,
        locked_at = CASE WHEN v_new = 0 THEN NULL ELSE locked_at END
    WHERE id = p_exam_id;
    PERFORM set_config('app.lock_change', '', true);
    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (v_acc, v_me, 'update', 'exams', p_exam_id, jsonb_build_object('previous_tier', v_current),
            jsonb_build_object('event', 'exam_lock_tier_lowered', 'new_tier', v_new));
    RETURN CASE WHEN v_new = 1 THEN 'تم رفع القفل درجة - مساعد الناظر فأعلى يقدر يعدّل الآن (الأستاذ لسا ممنوع)'
                ELSE 'تم رفع القفل بالكامل - الأستاذ يقدر يعدّل الآن كالمعتاد' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reopen_exam_submission(p_exam_id UUID, p_actor_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE v_me UUID := current_app_user_id(); v_acc UUID; v_class UUID;
BEGIN
    IF p_actor_id IS DISTINCT FROM v_me THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT account_id, class_section_id INTO v_acc, v_class FROM exams WHERE id = p_exam_id;
    IF v_acc IS DISTINCT FROM current_account_id() THEN RAISE EXCEPTION 'الامتحان غير موجود'; END IF;
    IF NOT has_capability_in('grades.finalize_submission', NULL, v_class, NULL) THEN
        RAISE EXCEPTION 'الفتح الفوري يتطلب الصلاحية grades.finalize_submission';
    END IF;
    PERFORM set_config('app.lock_change', '1', true);
    UPDATE exams SET lock_tier = 0, is_locked_by_admin = false, locked_by = NULL, locked_at = NULL WHERE id = p_exam_id;
    PERFORM set_config('app.lock_change', '', true);
    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_acc, v_me, 'update', 'exams', p_exam_id, jsonb_build_object('event', 'exam_grades_reopened_fully', 'reason', p_reason));
    RETURN 'تم فتح الامتحان بالكامل فوراً (تجاوز التدرّج)';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4) إدخال العلامات ونقلها: تحقق حساب/هوية/نطاق
CREATE OR REPLACE FUNCTION apply_grade_entry(p_exam_id UUID, p_student_id UUID, p_actor_id UUID, p_entries JSONB)
RETURNS TEXT AS $$
DECLARE
    v_entry JSONB; v_component_id UUID; v_new_score NUMERIC; v_resolution TEXT;
    v_existing_id UUID; v_existing_score NUMERIC; v_applied INTEGER := 0; v_skipped INTEGER := 0;
    v_acc UUID;
BEGIN
    IF p_actor_id IS DISTINCT FROM current_app_user_id() THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT account_id INTO v_acc FROM exams WHERE id = p_exam_id;
    IF v_acc IS DISTINCT FROM current_account_id() THEN RAISE EXCEPTION 'الامتحان غير موجود'; END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
        v_component_id := NULLIF(v_entry->>'component_id', '')::UUID;
        v_new_score := (v_entry->>'score')::NUMERIC;
        v_resolution := v_entry->>'resolution';

        SELECT id, score INTO v_existing_id, v_existing_score FROM grades
        WHERE exam_id = p_exam_id AND student_id = p_student_id AND component_id IS NOT DISTINCT FROM v_component_id;

        IF v_existing_id IS NULL THEN
            INSERT INTO grades (exam_id, student_id, component_id, score, entered_by, status)
            VALUES (p_exam_id, p_student_id, v_component_id, v_new_score, p_actor_id, 'confirmed');
            v_applied := v_applied + 1;
        ELSIF v_resolution = 'apply_new' THEN
            INSERT INTO grade_history (grade_id, old_score, new_score, resolution_method, changed_by)
            VALUES (v_existing_id, v_existing_score, v_new_score, 'overwrite', p_actor_id);
            UPDATE grades SET score = v_new_score, entered_by = p_actor_id, status = 'confirmed' WHERE id = v_existing_id;
            v_applied := v_applied + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_acc, p_actor_id, 'update', 'grades', p_exam_id,
            jsonb_build_object('event', 'grade_entry_with_conflict_check', 'student_id', p_student_id, 'applied', v_applied, 'skipped', v_skipped));
    RETURN format('تم اعتماد %s مكوّن، وتجاهل %s', v_applied, v_skipped);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION reassign_grades_to_exam(p_student_ids UUID[], p_from_exam_id UUID, p_to_exam_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_from exams%ROWTYPE; v_to exams%ROWTYPE; v_conflicts INTEGER; v_moved INTEGER;
BEGIN
    IF p_actor_id IS DISTINCT FROM current_app_user_id() THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT * INTO v_from FROM exams WHERE id = p_from_exam_id;
    SELECT * INTO v_to FROM exams WHERE id = p_to_exam_id;
    IF v_from.account_id IS DISTINCT FROM current_account_id() OR v_to.account_id IS DISTINCT FROM current_account_id() THEN
        RAISE EXCEPTION 'الامتحان غير موجود';
    END IF;
    IF v_from.class_section_id <> v_to.class_section_id OR v_from.subject_id <> v_to.subject_id THEN
        RAISE EXCEPTION 'النقل مسموح فقط بين امتحانات نفس الشعبة ونفس المادة';
    END IF;
    IF NOT has_capability_in('grades.edit_others', NULL, v_from.class_section_id, NULL) THEN
        RAISE EXCEPTION 'نقل العلامات يتطلب الصلاحية grades.edit_others';
    END IF;
    IF v_from.is_locked_by_admin OR v_to.is_locked_by_admin THEN
        RAISE EXCEPTION 'لا يمكن نقل العلامات - أحد الامتحانين (المصدر أو الهدف) معتمد نهائياً من الناظر';
    END IF;

    SELECT count(*) INTO v_conflicts FROM grades gf
    JOIN grades gt ON gt.exam_id = p_to_exam_id AND gt.student_id = gf.student_id AND gt.component_id IS NOT DISTINCT FROM gf.component_id
    WHERE gf.exam_id = p_from_exam_id AND gf.student_id = ANY(p_student_ids);
    IF v_conflicts > 0 THEN
        RAISE EXCEPTION 'يوجد % علامة بالامتحان الهدف لنفس الطالب/المكوّن - استخدم حل التعارض بدل النقل المباشر', v_conflicts;
    END IF;

    UPDATE grades SET exam_id = p_to_exam_id WHERE exam_id = p_from_exam_id AND student_id = ANY(p_student_ids);
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (v_from.account_id, p_actor_id, 'update', 'grades', p_from_exam_id,
            jsonb_build_object('event', 'grades_reassigned_to_correct_exam', 'from_exam_id', p_from_exam_id),
            jsonb_build_object('to_exam_id', p_to_exam_id, 'rows_moved', v_moved));
    RETURN format('تم نقل %s علامة للامتحان الصحيح', v_moved);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 5) نافذة العلامات: أدوار الإدارة أو صاحب window.toggle ضمن نطاق الشعبة
DROP POLICY exams_window_toggle ON exams;
CREATE POLICY exams_update ON exams FOR UPDATE USING (
    account_id = current_account_id()
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin']::user_role_enum[])
         OR has_capability_in('window.toggle', NULL, class_section_id, NULL))
) WITH CHECK (account_id = current_account_id());

-- 6) الاستيراد الجماعي
ALTER TABLE import_staging_classes ADD COLUMN raw_name TEXT, ADD COLUMN raw_stage_id UUID REFERENCES stages(id);
CREATE INDEX import_staging_classes_stage_idx ON import_staging_classes (raw_stage_id);

CREATE OR REPLACE FUNCTION analyze_class_import_batch(p_batch_id UUID)
RETURNS VOID AS $$
    UPDATE import_staging_classes s
    SET match_status = CASE WHEN EXISTS (
            SELECT 1 FROM class_sections c
            JOIN import_batches b ON b.id = s.batch_id
            WHERE c.account_id = b.account_id AND lower(trim(c.name)) = lower(trim(s.raw_name))) THEN 'identical'::import_row_match_enum
        ELSE 'new'::import_row_match_enum END,
        matched_class_id = (SELECT c.id FROM class_sections c JOIN import_batches b ON b.id = s.batch_id
            WHERE c.account_id = b.account_id AND lower(trim(c.name)) = lower(trim(s.raw_name)) LIMIT 1)
    WHERE s.batch_id = p_batch_id;
$$ LANGUAGE sql SET search_path = public;

CREATE OR REPLACE FUNCTION commit_student_import_batch(p_batch_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_batch import_batches%ROWTYPE; v_row RECORD; v_new_id UUID; v_added INTEGER := 0; v_updated INTEGER := 0; v_skipped INTEGER := 0;
    v_pn TEXT; v_pp TEXT; v_pe TEXT; v_old students%ROWTYPE; v_final TEXT;
BEGIN
    IF p_actor_id IS DISTINCT FROM current_app_user_id() THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    IF NOT has_capability('records.import_manage') THEN RAISE EXCEPTION 'الاعتماد يتطلب الصلاحية records.import_manage'; END IF;
    SELECT * INTO v_batch FROM import_batches WHERE id = p_batch_id AND account_id = current_account_id() AND entity_type = 'student';
    IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة'; END IF;
    IF v_batch.status <> 'pending_review' THEN RAISE EXCEPTION 'الدفعة معتمدة أو ملغاة مسبقاً'; END IF;
    IF NOT enforce_batch_fully_resolved(p_batch_id, 'student') THEN
        RAISE EXCEPTION 'لا يمكن الاعتماد: ما زال هناك أسطر متصادمة بدون قرار مراجع بشري';
    END IF;

    FOR v_row IN SELECT * FROM import_staging_students WHERE batch_id = p_batch_id LOOP
        v_final := COALESCE(NULLIF(trim(v_row.resolved_final_name), ''), v_row.raw_full_name);
        v_pn := NULLIF(trim(v_row.raw_extra->>'parent_name'), '');
        v_pp := NULLIF(trim(v_row.raw_extra->>'parent_phone'), '');
        v_pe := NULLIF(trim(v_row.raw_extra->>'parent_email'), '');

        IF v_row.resolved_action = 'ignore' OR (v_row.match_status = 'identical' AND v_row.resolved_action = 'pending') THEN
            v_skipped := v_skipped + 1; CONTINUE;
        END IF;

        IF v_row.match_status = 'new' OR (v_row.resolved_action = 'accept_new' AND v_row.matched_student_id IS NULL) THEN
            INSERT INTO students (account_id, full_name, parent_name, parent_phone, parent_email)
            VALUES (v_batch.account_id, v_final, v_pn, v_pp, v_pe) RETURNING id INTO v_new_id;
            IF v_row.raw_class_section_id IS NOT NULL THEN
                INSERT INTO class_enrollments (class_section_id, student_id) VALUES (v_row.raw_class_section_id, v_new_id);
            END IF;
            v_added := v_added + 1;
        ELSIF v_row.resolved_action IN ('accept_new', 'manual_edit') AND v_row.matched_student_id IS NOT NULL THEN
            SELECT * INTO v_old FROM students WHERE id = v_row.matched_student_id;
            IF v_old.full_name IS DISTINCT FROM v_final THEN
                INSERT INTO name_change_log (account_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, batch_id)
                VALUES (v_batch.account_id, 'student', v_old.id, 'full_name', v_old.full_name, v_final, p_actor_id, p_batch_id);
            END IF;
            IF v_pp IS NOT NULL AND v_old.parent_phone IS DISTINCT FROM v_pp THEN
                INSERT INTO name_change_log (account_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, batch_id)
                VALUES (v_batch.account_id, 'student', v_old.id, 'parent_phone', v_old.parent_phone, v_pp, p_actor_id, p_batch_id);
            END IF;
            UPDATE students SET full_name = v_final,
                parent_name = COALESCE(v_pn, parent_name), parent_phone = COALESCE(v_pp, parent_phone), parent_email = COALESCE(v_pe, parent_email)
            WHERE id = v_old.id;
            v_updated := v_updated + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    UPDATE import_batches SET status = 'committed', committed_at = now() WHERE id = p_batch_id;
    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_batch.account_id, p_actor_id, 'insert', 'students', p_batch_id,
            jsonb_build_object('event', 'bulk_import_commit', 'entity', 'student', 'added', v_added, 'updated', v_updated, 'skipped', v_skipped));
    RETURN format('تم الاعتماد: %s جديد، %s محدّث، %s متجاوَز', v_added, v_updated, v_skipped);
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION commit_class_import_batch(p_batch_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE v_batch import_batches%ROWTYPE; v_row RECORD; v_added INTEGER := 0; v_skipped INTEGER := 0;
BEGIN
    IF p_actor_id IS DISTINCT FROM current_app_user_id() THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    IF NOT has_capability('records.import_manage') THEN RAISE EXCEPTION 'الاعتماد يتطلب الصلاحية records.import_manage'; END IF;
    SELECT * INTO v_batch FROM import_batches WHERE id = p_batch_id AND account_id = current_account_id() AND entity_type = 'class';
    IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة'; END IF;
    IF v_batch.status <> 'pending_review' THEN RAISE EXCEPTION 'الدفعة معتمدة أو ملغاة مسبقاً'; END IF;

    FOR v_row IN SELECT * FROM import_staging_classes WHERE batch_id = p_batch_id LOOP
        IF v_row.resolved_action = 'ignore' OR v_row.match_status = 'identical' THEN
            v_skipped := v_skipped + 1; CONTINUE;
        END IF;
        INSERT INTO class_sections (account_id, name, grade_level, section_label, stage_id, created_by)
        VALUES (v_batch.account_id, v_row.raw_name, NULLIF(v_row.raw_grade_level, ''), NULLIF(v_row.raw_section_label, ''), v_row.raw_stage_id, p_actor_id);
        v_added := v_added + 1;
    END LOOP;

    UPDATE import_batches SET status = 'committed', committed_at = now() WHERE id = p_batch_id;
    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_batch.account_id, p_actor_id, 'insert', 'class_sections', p_batch_id,
            jsonb_build_object('event', 'bulk_import_commit', 'entity', 'class', 'added', v_added, 'skipped', v_skipped));
    RETURN format('تم الاعتماد: %s صف جديد، %s متجاوَز (موجود مسبقاً/مُتجاهَل)', v_added, v_skipped);
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 7) صلاحيات التنفيذ
REVOKE EXECUTE ON FUNCTION public.actor_exam_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actor_exam_tier(uuid) TO authenticated;
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'finalize_exam_submission(uuid, uuid)', 'lower_exam_lock_tier(uuid, uuid)', 'reopen_exam_submission(uuid, uuid, text)',
        'apply_grade_entry(uuid, uuid, uuid, jsonb)', 'reassign_grades_to_exam(uuid[], uuid, uuid, uuid)',
        'check_existing_grade_components(uuid, uuid)',
        'analyze_student_import_batch(uuid)', 'analyze_teacher_import_batch(uuid)', 'analyze_class_import_batch(uuid)',
        'commit_student_import_batch(uuid, uuid)', 'commit_class_import_batch(uuid, uuid)', 'enforce_batch_fully_resolved(uuid, import_entity_enum)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
-- =====================================================================
