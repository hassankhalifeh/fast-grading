-- =====================================================================
-- 08_grade_entry_conflict_resolution.sql
-- كشف الإدخال المكرر لعلامة امتحان بدقة مستوى المكوّن الواحد، مع قرار
-- منفصل لكل مكوّن: اعتماد الجديد / الإبقاء على القديم
--
-- مصحَّح: grade_history.resolution_method عمود NOT NULL بدون قيمة
-- افتراضية بالسكيما الحقيقية - نضبطه 'overwrite' لأنه استبدال مباشر
-- بالقيمة الجديدة. grades.status نضبطه 'confirmed' صراحة ليطابق سلوك
-- الإدخال المباشر بالواجهة (GradeEntryPanel.tsx).
-- =====================================================================

CREATE OR REPLACE FUNCTION check_existing_grade_components(
    p_exam_id UUID,
    p_student_id UUID
)
RETURNS TABLE (
    component_id UUID,
    component_name TEXT,
    existing_score NUMERIC,
    has_existing BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        etc.id AS component_id,
        etc.component_name AS component_name,
        g.score AS existing_score,
        (g.id IS NOT NULL) AS has_existing
    FROM exam_type_components etc
    JOIN exams e ON e.exam_type_id = etc.exam_type_id
    LEFT JOIN grades g ON g.exam_id = p_exam_id
                       AND g.student_id = p_student_id
                       AND g.component_id = etc.id
    WHERE e.id = p_exam_id

    UNION ALL

    SELECT NULL::UUID, 'العلامة الكاملة', g.score, (g.id IS NOT NULL)
    FROM exams e
    LEFT JOIN grades g ON g.exam_id = p_exam_id
                       AND g.student_id = p_student_id
                       AND g.component_id IS NULL
    WHERE e.id = p_exam_id
      AND NOT EXISTS (
          SELECT 1 FROM exam_type_components etc2 WHERE etc2.exam_type_id = e.exam_type_id
      );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_grade_entry(
    p_exam_id UUID,
    p_student_id UUID,
    p_actor_id UUID,
    p_entries JSONB
)
RETURNS TEXT AS $$
DECLARE
    v_entry JSONB;
    v_component_id UUID;
    v_new_score NUMERIC;
    v_resolution TEXT;
    v_existing_id UUID;
    v_existing_score NUMERIC;
    v_applied_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
BEGIN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_component_id := NULLIF(v_entry->>'component_id', '')::UUID;
        v_new_score := (v_entry->>'score')::NUMERIC;
        v_resolution := v_entry->>'resolution';

        SELECT id, score INTO v_existing_id, v_existing_score
        FROM grades
        WHERE exam_id = p_exam_id AND student_id = p_student_id
          AND component_id IS NOT DISTINCT FROM v_component_id;

        IF v_existing_id IS NULL THEN
            INSERT INTO grades (id, exam_id, student_id, component_id, score, entered_by, status)
            VALUES (gen_random_uuid(), p_exam_id, p_student_id, v_component_id, v_new_score, p_actor_id, 'confirmed');
            v_applied_count := v_applied_count + 1;

        ELSIF v_resolution = 'apply_new' THEN
            INSERT INTO grade_history (id, grade_id, old_score, new_score, resolution_method, changed_by, changed_at)
            VALUES (gen_random_uuid(), v_existing_id, v_existing_score, v_new_score, 'overwrite', p_actor_id, now());

            UPDATE grades SET score = v_new_score, entered_by = p_actor_id, status = 'confirmed'
            WHERE id = v_existing_id;
            v_applied_count := v_applied_count + 1;

        ELSE
            v_skipped_count := v_skipped_count + 1;
        END IF;
    END LOOP;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    SELECT e.account_id, p_actor_id, 'update', 'grades',
           jsonb_build_object('event', 'grade_entry_with_conflict_check', 'exam_id', p_exam_id,
                               'student_id', p_student_id, 'applied', v_applied_count, 'skipped', v_skipped_count)
    FROM exams e WHERE e.id = p_exam_id;

    RETURN format('تم اعتماد %s مكوّن، وتجاهل %s', v_applied_count, v_skipped_count);
END;
$$ LANGUAGE plpgsql;

-- ملاحظة تطبيق بالواجهة (Web App):
-- 1) عند فتح شاشة إدخال علامة طالب لامتحان → استدعاء check_existing_grade_components
-- 2) لكل صف has_existing = true تُعرض القيمة القديمة بجانب حقل الإدخال الجديد
--    مع مفتاح تبديل صغير (اعتماد الجديد / الإبقاء على القديم) لكل مكوّن
-- 3) زر علوي واحد "تجاهل كل التعديلات" يصفّر كل الاختيارات دفعة وحدة
-- 4) الإرسال النهائي يستدعي apply_grade_entry بمصفوفة القرارات المجمّعة فقط
-- =====================================================================
