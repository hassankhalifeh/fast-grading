-- =====================================================================
-- 22_tighten_config_writes.sql
-- جداول الإعداد (المواد، المراحل، أنواع الاختبارات، مكوّناتها، سياسة العلامات،
-- الفصول، أوزان الصفوف) كانت سياساتها القديمة FOR ALL بعزل الحساب فقط، يعني أي
-- عضو (حتى معلم مادة) يقدر يعدّلها. صارت تحدد المعدلات فنشترط config.manage
-- للكتابة، وتبقى القراءة لكل أعضاء الحساب.
-- + الناظر العام يحصل على grading.adjust افتراضياً.
-- =====================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['subjects','stages','exam_types','grading_policies','terms'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_scoped', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (account_id = current_account_id())', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability(''config.manage''))', t || '_insert', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (account_id = current_account_id() AND has_capability(''config.manage'')) WITH CHECK (account_id = current_account_id() AND has_capability(''config.manage''))', t || '_update', t);
        EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (account_id = current_account_id() AND has_capability(''config.manage''))', t || '_delete', t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS exam_type_components_scoped ON exam_type_components;
CREATE POLICY exam_type_components_select ON exam_type_components FOR SELECT
    USING (exam_type_id IN (SELECT id FROM exam_types WHERE account_id = current_account_id()));
CREATE POLICY exam_type_components_insert ON exam_type_components FOR INSERT
    WITH CHECK (has_capability('config.manage') AND exam_type_id IN (SELECT id FROM exam_types WHERE account_id = current_account_id()));
CREATE POLICY exam_type_components_update ON exam_type_components FOR UPDATE
    USING (has_capability('config.manage') AND exam_type_id IN (SELECT id FROM exam_types WHERE account_id = current_account_id()))
    WITH CHECK (has_capability('config.manage') AND exam_type_id IN (SELECT id FROM exam_types WHERE account_id = current_account_id()));
CREATE POLICY exam_type_components_delete ON exam_type_components FOR DELETE
    USING (has_capability('config.manage') AND exam_type_id IN (SELECT id FROM exam_types WHERE account_id = current_account_id()));

DROP POLICY IF EXISTS class_exam_type_weights_scoped ON class_exam_type_weights;
CREATE POLICY class_exam_type_weights_select ON class_exam_type_weights FOR SELECT
    USING (class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()));
CREATE POLICY class_exam_type_weights_insert ON class_exam_type_weights FOR INSERT
    WITH CHECK (has_capability('config.manage') AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()));
CREATE POLICY class_exam_type_weights_update ON class_exam_type_weights FOR UPDATE
    USING (has_capability('config.manage') AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()))
    WITH CHECK (has_capability('config.manage') AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()));
CREATE POLICY class_exam_type_weights_delete ON class_exam_type_weights FOR DELETE
    USING (has_capability('config.manage') AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()));

CREATE OR REPLACE FUNCTION apply_default_capabilities(p_app_user_id uuid, p_role user_role_enum)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin
  delete from user_capabilities where app_user_id = p_app_user_id;

  if p_role = 'solo_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    select p_app_user_id, key from capabilities;
  elsif p_role = 'school_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'window.toggle'),
           (p_app_user_id, 'reports.view'), (p_app_user_id, 'reports.export'),
           (p_app_user_id, 'config.manage'), (p_app_user_id, 'users.manage'),
           (p_app_user_id, 'notifications.send'), (p_app_user_id, 'roster.manage'),
           (p_app_user_id, 'grading.adjust');
  elsif p_role = 'assistant_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter'), (p_app_user_id, 'grades.edit_others'),
           (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'roster.manage');
  elsif p_role = 'subject_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter');
  elsif p_role = 'custom_role' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'reports.view');
  end if;
end;
$function$;
-- =====================================================================
