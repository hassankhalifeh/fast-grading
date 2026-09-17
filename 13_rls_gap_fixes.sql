-- =====================================================================
-- 13_rls_gap_fixes.sql
-- يسدّ فجوات RLS موجودة من قبل هالجلسة (مش ناتجة عن 07-12):
--
-- 1) subjects / custom_roles / notification_templates / class_subject_teachers
--    كانت RLS enabled بدون أي policy إطلاقاً - محجوبة بالكامل عن أي طلب
--    غير service_role. class_subject_teachers تحديداً كانت سبب عطل فعلي:
--    سياسات grades_write_subject_teacher/grades_update_subject_teacher
--    الموجودة أصلاً بتعتمد JOIN عليها، فبدون سياسة قراءة، أي مستخدم
--    بدور subject_teacher كان عاجز عن إدخال/تعديل أي علامة إطلاقاً.
--
-- 2) students / class_enrollments كان عندهم سياسة SELECT بس بدون أي
--    سياسة INSERT/UPDATE/DELETE - إضافة طالب أو تسجيله بصف كانت سترفض دائماً.
--
-- 3) user_capabilities: السياسة الموجودة كانت تسمح لأي عضو بالحساب
--    يكتب مباشرة بدون أي تحقق صلاحية. نستبدلها بقراءة مفتوحة على مستوى
--    الحساب + كتابة تتطلب users.manage.
-- =====================================================================

CREATE POLICY subjects_scoped ON subjects FOR ALL
    USING (account_id = current_account_id())
    WITH CHECK (account_id = current_account_id());

CREATE POLICY custom_roles_scoped ON custom_roles FOR ALL
    USING (account_id = current_account_id())
    WITH CHECK (account_id = current_account_id());

CREATE POLICY notification_templates_read ON notification_templates
    FOR SELECT USING (account_id = current_account_id());

CREATE POLICY notification_templates_write ON notification_templates
    FOR ALL USING (
        account_id = current_account_id()
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    )
    WITH CHECK (
        account_id = current_account_id()
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    );

CREATE POLICY class_subject_teachers_read ON class_subject_teachers
    FOR SELECT USING (class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id()));

CREATE POLICY class_subject_teachers_write ON class_subject_teachers
    FOR ALL USING (
        class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    )
    WITH CHECK (
        class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    );

CREATE POLICY students_admin_write ON students
    FOR ALL USING (
        account_id = current_account_id()
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    )
    WITH CHECK (
        account_id = current_account_id()
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    );

CREATE POLICY class_enrollments_admin_write ON class_enrollments
    FOR ALL USING (
        class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    )
    WITH CHECK (
        class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    );

DROP POLICY user_capabilities_scoped ON user_capabilities;

CREATE POLICY user_capabilities_read ON user_capabilities
    FOR SELECT USING (app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id()));

CREATE POLICY user_capabilities_write ON user_capabilities
    FOR ALL USING (
        has_capability('users.manage')
        AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id())
    )
    WITH CHECK (
        has_capability('users.manage')
        AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id())
    );
-- ملاحظة: سياسات notification_templates_write / class_subject_teachers_write /
-- students_admin_write / class_enrollments_admin_write / user_capabilities_write
-- أعلاه استُبدلت لاحقاً بملف 15 (FOR ALL كانت تتداخل مع سياسات SELECT منفصلة)
-- =====================================================================
