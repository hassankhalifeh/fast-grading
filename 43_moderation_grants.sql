-- 43: دالة توحيد النص عامة الاستعمال لكنها لا تلزم دور anon
revoke all on function public.mod_normalize(text) from public, anon;
grant execute on function public.mod_normalize(text) to authenticated, service_role;
