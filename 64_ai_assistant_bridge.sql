-- 64_ai_assistant_bridge.sql
-- جسر مساعد الذكاء الاصطناعي (Devology AI): دوال قراءة فقط يستدعيها الموصّل المستضاف في Devology بتوكن المستخدم نفسه،
-- فيقرر Fast Grading بصلاحيات المستخدم وقواعد RLS كما لو فتح الشاشة بنفسه. Devology لا يملك مفتاح خدمة لهذا البرنامج.
--
-- القرارات (المرحلة 1):
--  * إضافة اختيارية لكل حساب: مفتاح الإضافة ai_assistant في account_features يمنحه مالك المنصة، وإلا ترفض كل الدوال (42501).
--  * خصوصية القاصرين: لا تخرج أسماء الطلاب ولا علاماتهم الفردية إلى النموذج في هذه المرحلة؛ المصادر = أعداد وأسماء صفوف/مواد/امتحانات
--    ومتوسطات صفوف وأدلة المساعدة وإسناد الأساتذة. بحث الطلاب ونتائجهم مرحلة لاحقة بموافقة صريحة.
--  * إعداد المنصة (عنوان البوابة ومعرّف التطبيق في Devology) في جدول مغلق على مالك المنصة؛ المستخدم يحصل عليه عبر ai_assistant_config() فقط.
-- قاعدة: كل دالة جديدة تسحب EXECUTE من public و anon صراحةً.
set search_path to fastgrading;

create table if not exists ai_assistant_settings (
  id              boolean primary key default true check (id),
  application_id  uuid,
  gateway_url     text check (gateway_url is null or gateway_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now()
);
insert into ai_assistant_settings (id) values (true) on conflict do nothing;
alter table ai_assistant_settings enable row level security;
drop policy if exists ai_assistant_settings_platform on ai_assistant_settings;
create policy ai_assistant_settings_platform on ai_assistant_settings for all using (is_platform_admin()) with check (is_platform_admin());
revoke all on ai_assistant_settings from anon, authenticated;
grant select, update on ai_assistant_settings to authenticated;
grant all on ai_assistant_settings to service_role;

-- هل المساعد مفعّل لحساب المستخدم؟ (إعداد المنصة مفعّل + الإضافة ممنوحة + الاشتراك ساري)
create or replace function ai_enabled() returns boolean
language sql stable security definer set search_path to 'fastgrading', 'pg_temp' as $$
  select coalesce((select s.enabled and s.application_id is not null and s.gateway_url is not null from ai_assistant_settings s where s.id), false)
     and account_has_feature('ai_assistant') and account_subscription_ok();
$$;
revoke all on function ai_enabled() from public, anon;
grant execute on function ai_enabled() to authenticated, service_role;

create or replace function ai_guard() returns void
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  if not ai_enabled() then raise exception 'AI assistant is not enabled for this account' using errcode = '42501'; end if;
end $$;
revoke all on function ai_guard() from public, anon;
grant execute on function ai_guard() to authenticated, service_role;

-- ما تحتاجه واجهة المساعد في المتصفح (لا شيء إن لم يكن مفعّلاً لهذا الحساب)
create or replace function ai_assistant_config() returns jsonb
language sql stable security definer set search_path to 'fastgrading', 'pg_temp' as $$
  select case when ai_enabled() then (select jsonb_build_object('application_id', s.application_id, 'gateway_url', s.gateway_url) from ai_assistant_settings s where s.id) else null end;
$$;
revoke all on function ai_assistant_config() from public, anon;
grant execute on function ai_assistant_config() to authenticated, service_role;

-- هوية المستخدم وصلاحياته لـDevology: رموز الصلاحيات = مفاتيح capabilities نفسها + app.use
create or replace function ai_my_access() returns jsonb
language sql stable security definer set search_path to 'fastgrading', 'pg_temp' as $$
  select jsonb_build_object(
    'display_name', u.full_name, 'locale', 'ar', 'roles', jsonb_build_array(u.role::text),
    'allow', case when ai_enabled() then
        (select coalesce(jsonb_agg(distinct s.c), '[]'::jsonb) from (select uc.capability_key as c from user_capabilities uc where uc.app_user_id = u.id and uc.granted union select 'app.use') s)
      else '[]'::jsonb end)
  from app_users u where u.id = current_app_user_id() and u.is_active;
$$;
revoke all on function ai_my_access() from public, anon;
grant execute on function ai_my_access() to authenticated, service_role;

-- مصادر القراءة (SECURITY INVOKER: RLS يحدّد ما يراه المستخدم)
create or replace function ai_pending_work() returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return my_pending_work();
end $$;

create or replace function ai_subscription() returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return my_subscription_status();
end $$;

create or replace function ai_incomplete_exams(p_limit integer default 30) returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select e.exam_name as exam, cs.name as class, sb.name as subject, e.exam_date as date,
             (select count(distinct g.student_id) from grades g where g.exam_id = e.id) as graded,
             case when e.supplementary_session_id is not null
               then (select count(*) from supplementary_eligibility s where s.session_id = e.supplementary_session_id and s.class_section_id = e.class_section_id and s.subject_id = e.subject_id)
               else (select count(*) from class_enrollments ce where ce.class_section_id = e.class_section_id and ce.status = 'active') end as expected
      from exams e join class_sections cs on cs.id = e.class_section_id join subjects sb on sb.id = e.subject_id
      where e.account_id = current_account_id() and e.exam_date <= current_date and not e.is_locked_by_admin
      order by e.exam_date desc limit 300
    ) x where x.graded < x.expected limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ), '[]'::jsonb);
end $$;

create or replace function ai_uncovered_subjects() returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return coalesce((
    select jsonb_agg(jsonb_build_object('class', cs.name, 'subject', s.name) order by cs.name, s.name)
    from class_sections cs join subjects s on s.account_id = cs.account_id
    where cs.account_id = current_account_id() and cs.is_active
      and not exists (select 1 from class_subject_teachers t where t.class_section_id = cs.id and t.subject_id = s.id and t.assignment_role = 'primary')
  ), '[]'::jsonb);
end $$;

-- متوسطات الصفوف فقط (تجميع، بلا أسماء طلاب)
create or replace function ai_class_overview() returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'class', cs.name,
      'students', (select count(*) from class_enrollments ce where ce.class_section_id = cs.id and ce.status = 'active'),
      'term_averages', coalesce((select jsonb_agg(jsonb_build_object('term', t.name, 'class_average', round(v.class_average::numeric, 1)) order by t.order_index)
                                 from v_class_term_summary v join terms t on t.id = v.term_id where v.class_section_id = cs.id), '[]'::jsonb)
    ) order by cs.name)
    from class_sections cs where cs.account_id = current_account_id() and cs.is_active
  ), '[]'::jsonb);
end $$;

create or replace function ai_my_teaching() returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return coalesce((
    select jsonb_agg(jsonb_build_object('class', cs.name, 'subject', s.name, 'role', t.assignment_role) order by cs.name, s.name)
    from class_subject_teachers t join class_sections cs on cs.id = t.class_section_id join subjects s on s.id = t.subject_id
    where t.teacher_id = current_app_user_id() and cs.is_active
  ), '[]'::jsonb);
end $$;

-- أدلة المساعدة المتاحة لهذا المستخدم (RLS على help_articles يحدّد الجمهور) مرتّبة بعدد كلمات السؤال المطابقة
create or replace function ai_help_search(p_query text) returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
declare v_words text[];
begin
  perform ai_guard();
  select coalesce(array_agg(q.w), '{}') into v_words
  from (select distinct w from unnest(regexp_split_to_array(normalize_ar(left(coalesce(p_query, ''), 300)), '\s+')) w where length(w) >= 3 limit 8) q;
  return coalesce((
    select jsonb_agg(jsonb_build_object('title', x.title, 'slug', x.slug, 'text', left(x.body_md, 6000)))
    from (
      select a.title, a.slug, a.body_md,
             (select count(*) from unnest(v_words) w where normalize_ar(a.title || ' ' || a.body_md) like '%' || w || '%') as score
      from help_articles a where a.published order by 4 desc, a.sort_order limit 2
    ) x where x.score > 0
  ), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array['ai_pending_work()', 'ai_subscription()', 'ai_incomplete_exams(integer)', 'ai_uncovered_subjects()', 'ai_class_overview()', 'ai_my_teaching()', 'ai_help_search(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

reset search_path;
