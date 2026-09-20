-- =====================================================================
-- 33_grade_entry_method.sql
-- apply_grade_entry يقبل entry_method لكل عنصر ('manual' أو 'voice') ويسجّله على العلامة،
-- ليُعرف لاحقاً (بالتقارير والتدقيق) أي علامة دخلت بالصوت.
-- =====================================================================
CREATE OR REPLACE FUNCTION apply_grade_entry(p_exam_id UUID, p_student_id UUID, p_actor_id UUID, p_entries JSONB)
RETURNS TEXT AS $$
DECLARE
    v_entry JSONB; v_component_id UUID; v_new_score NUMERIC; v_resolution TEXT; v_method entry_method_enum;
    v_existing_id UUID; v_existing_score NUMERIC; v_applied INTEGER := 0; v_skipped INTEGER := 0; v_voice INTEGER := 0;
    v_acc UUID;
BEGIN
    IF p_actor_id IS DISTINCT FROM current_app_user_id() THEN RAISE EXCEPTION 'هوية المنفّذ غير مطابقة للجلسة'; END IF;
    SELECT account_id INTO v_acc FROM exams WHERE id = p_exam_id;
    IF v_acc IS DISTINCT FROM current_account_id() THEN RAISE EXCEPTION 'الامتحان غير موجود'; END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
        v_component_id := NULLIF(v_entry->>'component_id', '')::UUID;
        v_new_score := (v_entry->>'score')::NUMERIC;
        v_resolution := v_entry->>'resolution';
        v_method := CASE WHEN v_entry->>'entry_method' = 'voice' THEN 'voice' ELSE 'manual' END;

        SELECT id, score INTO v_existing_id, v_existing_score FROM grades
        WHERE exam_id = p_exam_id AND student_id = p_student_id AND component_id IS NOT DISTINCT FROM v_component_id;

        IF v_existing_id IS NULL THEN
            INSERT INTO grades (exam_id, student_id, component_id, score, entered_by, status, entry_method)
            VALUES (p_exam_id, p_student_id, v_component_id, v_new_score, p_actor_id, 'confirmed', v_method);
            v_applied := v_applied + 1;
            IF v_method = 'voice' THEN v_voice := v_voice + 1; END IF;
        ELSIF v_resolution = 'apply_new' THEN
            INSERT INTO grade_history (grade_id, old_score, new_score, resolution_method, changed_by)
            VALUES (v_existing_id, v_existing_score, v_new_score, 'overwrite', p_actor_id);
            UPDATE grades SET score = v_new_score, entered_by = p_actor_id, status = 'confirmed', entry_method = v_method WHERE id = v_existing_id;
            v_applied := v_applied + 1;
            IF v_method = 'voice' THEN v_voice := v_voice + 1; END IF;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_acc, p_actor_id, 'update', 'grades', p_exam_id,
            jsonb_build_object('event', 'grade_entry_with_conflict_check', 'student_id', p_student_id,
                               'applied', v_applied, 'skipped', v_skipped, 'by_voice', v_voice));
    RETURN format('تم اعتماد %s مكوّن، وتجاهل %s', v_applied, v_skipped);
END;
$$ LANGUAGE plpgsql SET search_path = public;
