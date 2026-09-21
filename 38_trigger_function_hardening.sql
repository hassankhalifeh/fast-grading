-- 38: تحصين دوال المُشغّلات الجديدة (لا حاجة لأي دور باستدعائها مباشرة)
revoke all on function public.tg_accounts_default_settings() from public, anon, authenticated;
alter function public.tg_template_touch() set search_path = public, pg_temp;
revoke all on function public.tg_template_touch() from public, anon, authenticated;
revoke all on function public.tg_guard_notification_batch() from public, anon, authenticated;
revoke all on function public.tg_guard_notification_row() from public, anon, authenticated;
