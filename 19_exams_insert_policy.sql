-- =====================================================================
-- 19_exams_insert_policy.sql
-- جدول exams كان بدون سياسة INSERT، فشاشة "الامتحانات" كانت سترفض دائماً.
-- =====================================================================
CREATE POLICY exams_admin_insert ON exams FOR INSERT WITH CHECK (
    account_id = current_account_id()
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);
