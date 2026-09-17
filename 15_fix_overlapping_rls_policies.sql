-- =====================================================================
-- 15_fix_overlapping_rls_policies.sql
-- بعض سياسات RLS المضافة بملف 13 استخدمت FOR ALL يلي بيغطي SELECT
-- ضمنياً، متداخلة مع سياسة قراءة منفصلة على نفس الجدول - Postgres
-- بيقيّم السياستين لكل استعلام قراءة (صحيح النتيجة، بس أداء زائد).
-- نفس المشكلة كانت موجودة أصلاً بـ import_batches_isolation (بدون FOR
-- = يغطي كل الأوامر) متداخلة مع import_batches_write (INSERT فقط)،
-- وما كانت أصلاً تغطي UPDATE بشكل صريح (commit_student_import_batch
-- بيعمل UPDATE على status - كان يعتمد ضمنياً على isolation الشاملة).
-- نستبدل الكل بسياسات محدّدة الأمر (INSERT/UPDATE/DELETE منفصلة).
-- =====================================================================

DROP POLICY notification_templates_write ON notification_templates;
CREATE POLICY notification_templates_insert ON notification_templates FOR INSERT WITH CHECK (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY notification_templates_update ON notification_templates FOR UPDATE USING (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
) WITH CHECK (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY notification_templates_delete ON notification_templates FOR DELETE USING (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

DROP POLICY class_subject_teachers_write ON class_subject_teachers;
CREATE POLICY class_subject_teachers_insert ON class_subject_teachers FOR INSERT WITH CHECK (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY class_subject_teachers_update ON class_subject_teachers FOR UPDATE USING (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
) WITH CHECK (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY class_subject_teachers_delete ON class_subject_teachers FOR DELETE USING (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

DROP POLICY students_admin_write ON students;
CREATE POLICY students_insert ON students FOR INSERT WITH CHECK (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY students_update ON students FOR UPDATE USING (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
) WITH CHECK (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY students_delete ON students FOR DELETE USING (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

DROP POLICY class_enrollments_admin_write ON class_enrollments;
CREATE POLICY class_enrollments_insert ON class_enrollments FOR INSERT WITH CHECK (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY class_enrollments_update ON class_enrollments FOR UPDATE USING (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
) WITH CHECK (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
CREATE POLICY class_enrollments_delete ON class_enrollments FOR DELETE USING (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

DROP POLICY user_capabilities_write ON user_capabilities;
CREATE POLICY user_capabilities_insert ON user_capabilities FOR INSERT WITH CHECK (
    has_capability('users.manage')
    AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id())
);
CREATE POLICY user_capabilities_delete ON user_capabilities FOR DELETE USING (
    has_capability('users.manage')
    AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id())
);

DROP POLICY import_batches_isolation ON import_batches;
CREATE POLICY import_batches_select ON import_batches FOR SELECT USING (account_id = current_account_id());
CREATE POLICY import_batches_update ON import_batches FOR UPDATE USING (
    account_id = current_account_id() AND has_capability('records.import_manage')
) WITH CHECK (
    account_id = current_account_id() AND has_capability('records.import_manage')
);
-- =====================================================================
