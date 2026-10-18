-- 59_anon_function_lockdown_and_public_rpc.sql
-- يسمح لزائر غير مسجَّل (anon) باستدعاء دالتين عامتين فقط (صفحة /apply) دون فتح أي شيء آخر.
--
-- المشكلة: anon لا يملك USAGE على المخطط fastgrading، فلا تستطيع الصفحة العامة استدعاء list_public_plans ولا
-- submit_account_application. لكن anon يملك EXECUTE على تقريباً كل دوال المخطط (الافتراضي: PUBLIC)، ولا يحميها اليوم إلا غياب USAGE.
-- (كانت الترحيلة 23 قد سحبت هذه الصلاحية في المشروع القديم، وضاع أثرها عند النقل إلى مخطط fastgrading.)
-- لذلك قبل منح USAGE نسحب EXECUTE من PUBLIC و anon عن كل الدوال، ونعيد منحه صراحةً لمن كان يملكه فعلاً (authenticated / service_role)،
-- ثم نمنح anon الدالتين العامتين وحدهما.
--
-- دوال الإضافات (pg_trgm داخل هذا المخطط) تُستثنى: هي دوال نقية بلا أثر جانبي.
set search_path to fastgrading;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as svc_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'fastgrading' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.svc_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;

-- الدوال الجديدة مستقبلاً لا تُمنح لـPUBLIC تلقائياً
alter default privileges in schema fastgrading revoke execute on functions from public;

grant usage on schema fastgrading to anon;
grant execute on function list_public_plans() to anon;
grant execute on function submit_account_application(text, text, text, text, text, text, text, integer, text, text) to anon;

reset search_path;
