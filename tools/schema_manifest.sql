-- Schema manifest for the fastgrading schema (read-only).
-- Returns one row per database object: kind, name, md5 of its definition.
-- Wrap it in the summary below to get one hash per kind (the checked-in baseline in supabase/schema_manifest.md),
-- or run it as is and diff two environments row by row when a hash differs.
--
-- Covers: tables+columns, constraints, indexes, RLS flag, policies, functions (full definition incl. search_path and execute privileges),
-- triggers, views (definition + reloptions such as security_invoker), enums, table grants.
-- Extension-owned objects (pg_trgm lives in this schema) are excluded.

with s as (select 'fastgrading'::name as nsp),
cols as (
  select 'table' as kind, c.relname::text as name,
    md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attname)
        || ':rls=' || c.relrowsecurity::text) as h
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace cross join s
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = s.nsp and c.relkind in ('r', 'p')
  group by c.relname, c.relrowsecurity
),
cons as (
  select 'constraint', c.conrelid::regclass::text || '.' || c.conname, md5(pg_get_constraintdef(c.oid))
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace cross join s where n.nspname = s.nsp
),
idx as (
  select 'index', i.tablename || '.' || i.indexname, md5(i.indexdef) from pg_indexes i cross join s where i.schemaname = s.nsp
),
pol as (
  select 'policy', p.tablename || '.' || p.policyname,
    md5(p.cmd || ':' || array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''))
  from pg_policies p cross join s where p.schemaname = s.nsp
),
fn as (
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid) || ':acl=' || coalesce(p.proacl::text, ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join s
  where n.nspname = s.nsp and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
trg as (
  select 'trigger', c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace cross join s
  where n.nspname = s.nsp and not t.tgisinternal
),
vw as (
  select 'view', c.relname::text, md5(pg_get_viewdef(c.oid) || ':' || coalesce(array_to_string(c.reloptions, ','), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join s
  where n.nspname = s.nsp and c.relkind in ('v', 'm')
),
en as (
  select 'enum', t.typname::text, md5(string_agg(e.enumlabel, ',' order by e.enumsortorder))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace cross join s
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = s.nsp group by t.typname
),
gr as (
  select 'grant', g.table_name || '.' || g.grantee, md5(string_agg(g.privilege_type, ',' order by g.privilege_type))
  from information_schema.role_table_grants g cross join s
  where g.table_schema = s.nsp and g.grantee in ('anon', 'authenticated', 'service_role')
  group by g.table_name, g.grantee
)
select kind, name, h as md5 from (
  select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from fn union all select * from trg union all select * from vw union all select * from en
  union all select * from gr
) x order by kind, name;

-- Summary (one hash per kind): replace the final select above with
--   select kind, count(*) as n, md5(string_agg(name || '=' || h, ',' order by name)) as hash from ( ...same union... ) x group by kind order by kind;
