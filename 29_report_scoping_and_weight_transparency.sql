-- =====================================================================
-- 29_report_scoping_and_weight_transparency.sql
-- 1) قراءة العلامات كانت لكل أعضاء الحساب (grades_read_account) فأي معلم كان يرى
--    علامات كل المدرسة عبر جداول التقارير (views بـ security_invoker تحترم RLS).
--    الآن: يقرأ العلامات من عنده grades.view_all أو reports.view ضمن نطاق الشعبة
--    (عام أو نطاق مجموعة أو ملكية ناظر/مساعد)، أو المعلم المُسنَد للمادة والشعبة،
--    أو من أدخل العلامة بنفسه.
-- 2) شفافية الأوزان بالتقارير: weight_source + effective_weights_report(class, subject)
--    تعرض الوزن الافتراضي والفعلي ومصدره (افتراضي/مرحلة/صف/مادة/...).
-- =====================================================================

DROP POLICY grades_read_account ON grades;
CREATE POLICY grades_read_scoped ON grades FOR SELECT USING (
    exam_id IN (
        SELECT e.id FROM exams e
        WHERE e.account_id = current_account_id()
          AND (
              has_capability_in('grades.view_all', NULL, e.class_section_id, NULL)
              OR has_capability_in('reports.view', NULL, e.class_section_id, NULL)
              OR EXISTS (SELECT 1 FROM class_subject_teachers t
                         WHERE t.class_section_id = e.class_section_id AND t.subject_id = e.subject_id
                           AND t.teacher_id = current_app_user_id())
          )
    )
    OR entered_by = current_app_user_id()
);

CREATE OR REPLACE FUNCTION weight_source(p_target override_target_enum, p_target_id UUID, p_class UUID, p_subject UUID)
RETURNS TEXT AS $$
    SELECT o.scope::text
    FROM grading_overrides o
    LEFT JOIN class_sections cs ON cs.id = p_class
    WHERE o.target = p_target
      AND COALESCE(o.term_id, o.item_id, o.exam_id) = p_target_id
      AND (
           (o.scope = 'class_subject' AND o.class_section_id = p_class AND o.subject_id = p_subject)
        OR (o.scope = 'class'         AND o.class_section_id = p_class)
        OR (o.scope = 'subject'       AND o.subject_id = p_subject)
        OR (o.scope = 'stage'         AND o.stage_id = cs.stage_id)
        OR (o.scope = 'school')
      )
    ORDER BY CASE o.scope WHEN 'class_subject' THEN 1 WHEN 'class' THEN 2 WHEN 'subject' THEN 3 WHEN 'stage' THEN 4 ELSE 5 END
    LIMIT 1;
$$ LANGUAGE sql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION effective_weights_report(p_class UUID, p_subject UUID)
RETURNS TABLE (
    term_id UUID, term_name TEXT, term_order INTEGER, term_default NUMERIC, term_effective NUMERIC, term_source TEXT,
    item_id UUID, item_name TEXT, item_order INTEGER, item_default NUMERIC, item_effective NUMERIC, item_source TEXT
) AS $$
    SELECT t.id, t.name, t.order_index, t.default_weight, effective_term_weight(t.id, p_class, p_subject),
           COALESCE(weight_source('term_weight', t.id, p_class, p_subject), 'default'),
           i.id, i.name, i.order_index, i.default_weight, effective_item_weight(i.id, p_class, p_subject),
           COALESCE(weight_source('item_weight', i.id, p_class, p_subject), 'default')
    FROM terms t
    JOIN assessment_items i ON i.term_id = t.id
    WHERE t.account_id = current_account_id()
    ORDER BY t.order_index, i.order_index;
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.weight_source(override_target_enum, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.effective_weights_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.weight_source(override_target_enum, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_weights_report(uuid, uuid) TO authenticated;
-- =====================================================================
