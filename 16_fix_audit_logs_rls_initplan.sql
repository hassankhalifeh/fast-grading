-- =====================================================================
-- 16_fix_audit_logs_rls_initplan.sql
-- audit_logs_read_own_account كانت بتنادي auth.uid() مباشرة، فبتنعاد
-- تقييمها لكل صف بدل مرة وحدة للاستعلام كامل. (select auth.uid()) بيخلي
-- Postgres يعاملها كقيمة ثابتة تُحسب مرة وحدة (InitPlan).
-- =====================================================================

DROP POLICY audit_logs_read_own_account ON audit_logs;
CREATE POLICY audit_logs_read_own_account ON audit_logs
    FOR SELECT USING (
        account_id IN (SELECT app_users.account_id FROM app_users WHERE app_users.auth_uid = (SELECT auth.uid()))
    );
-- =====================================================================
