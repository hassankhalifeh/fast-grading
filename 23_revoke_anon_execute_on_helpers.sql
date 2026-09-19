-- =====================================================================
-- 23_revoke_anon_execute_on_helpers.sql
-- دوال المساعدة SECURITY DEFINER (تُرجع بيانات صاحب الجلسة فقط) كانت قابلة
-- للاستدعاء من زائر غير مسجّل عبر /rest/v1/rpc. نسحب التنفيذ من anon/PUBLIC
-- ونبقيه للمستخدمين المسجّلين (لازم لتقييم سياسات RLS).
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.can_adjust_grading(override_scope_enum, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_account_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_app_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.group_covers(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_capability(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_capability_in(text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_adjust_grading(override_scope_enum, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_covers(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_capability(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_capability_in(text, uuid, uuid, uuid) TO authenticated;
