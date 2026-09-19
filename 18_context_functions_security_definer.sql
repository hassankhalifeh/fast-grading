-- =====================================================================
-- 18_context_functions_security_definer.sql
-- ملف 14 ثبّت search_path على دوال السياق فمنع الـ inlining، فصارت سياسات
-- RLS على app_users/user_capabilities تنادي دوالاً تقرأ نفس الجداول بنفس
-- الـ RLS (تكرار لا نهائي: stack depth limit exceeded). نجعلها
-- SECURITY DEFINER (كلها تُرجع بيانات صاحب الجلسة فقط عبر auth.uid()).
-- ملاحظة: أي تثبيت search_path مستقبلي على دوال SQL مستخدمة داخل سياسات RLS
-- يجب أن يترافق مع SECURITY DEFINER لنفس السبب.
-- =====================================================================
ALTER FUNCTION public.current_app_user() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.current_account_id() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.current_app_user_id() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.has_capability(text) SECURITY DEFINER SET search_path = public;
