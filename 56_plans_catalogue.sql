-- 56_plans_catalogue.sql
-- كتالوج الباقات: يعرّف مالك المنصة باقات جاهزة (حدود + إضافات + مدة) ثم يطبّقها على الحسابات بنقرة.
--
-- لا أسعار ولا دفع هنا عمداً (الدفع مؤجَّل لما بعد الإطلاق الفعلي). الباقة وصف لما يحصل عليه الحساب فقط.
-- plan_type في subscription_profiles يحمل مفتاح الباقة (plans.key) عند تطبيقها؛ الحسابات القديمة تحتفظ بقيمتها (مثل school_custom).
-- التطبيق عبر دالة SECURITY DEFINER لمالك المنصة وحده، فلا حاجة لتعديل Edge Function ولا لنشرها.
set search_path to fastgrading;

create table if not exists plans (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique check (key ~ '^[a-z0-9_-]{2,40}$'),
  name_ar             text not null check (length(trim(name_ar)) > 0),
  description         text,
  account_type        text check (account_type in ('school_enterprise', 'solo_teacher')),   -- null = تصلح لأي نوع
  class_limit         integer not null check (class_limit >= 0),
  students_per_class  integer not null check (students_per_class >= 0),
  total_students      integer not null check (total_students >= 0),
  max_buildings       integer not null check (max_buildings >= 0),
  max_stages          integer not null check (max_stages >= 0),
  features            text[] not null default '{}',
  duration_days       integer check (duration_days is null or duration_days > 0),            -- null = بلا انتهاء
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table plans enable row level security;
drop policy if exists plans_platform_admin on plans;
create policy plans_platform_admin on plans for all using (is_platform_admin()) with check (is_platform_admin());

create or replace function plans_touch() returns trigger
language plpgsql set search_path to 'fastgrading', 'pg_temp' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_plans_touch on plans;
create trigger trg_plans_touch before update on plans for each row execute function plans_touch();

revoke all on plans from anon;
grant select, insert, update, delete on plans to authenticated;
grant all on plans to service_role;

-- تطبيق باقة على حساب: يضبط الحدود (ويصفّر التمديدات) وتاريخ الانتهاء ويفعّل إضافات الباقة. لا يوقف إضافات أخرى ولا يغيّر حالة الاشتراك.
-- p_keep_expiry = true يُبقي تاريخ الانتهاء الحالي كما هو.
create or replace function apply_plan_to_account(p_account uuid, p_plan text, p_keep_expiry boolean default false) returns jsonb
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare pl plans; acc_type text; v_expires timestamptz;
begin
  if not is_platform_admin() then
    raise exception 'تطبيق الباقات من صلاحية مالك المنصة فقط';
  end if;
  select * into pl from plans where key = p_plan;
  if not found then raise exception 'الباقة غير موجودة'; end if;
  if not pl.is_active then raise exception 'هذه الباقة غير مفعّلة'; end if;
  select account_type::text into acc_type from accounts where id = p_account;
  if acc_type is null then raise exception 'حساب غير موجود'; end if;
  if pl.account_type is not null and pl.account_type <> acc_type then
    raise exception 'هذه الباقة لا تناسب نوع الحساب';
  end if;

  v_expires := case when pl.duration_days is null then null else now() + make_interval(days => pl.duration_days) end;

  insert into subscription_profiles (account_id, plan_type, default_class_limit, default_student_per_class, default_total_student_limit,
                                     allowed_class_extension, allowed_student_extension, max_buildings, max_stages, expires_at, updated_by_platform)
  values (p_account, pl.key, pl.class_limit, pl.students_per_class, pl.total_students, 0, 0, pl.max_buildings, pl.max_stages, v_expires, true)
  on conflict (account_id) do update set
    plan_type = excluded.plan_type,
    default_class_limit = excluded.default_class_limit,
    default_student_per_class = excluded.default_student_per_class,
    default_total_student_limit = excluded.default_total_student_limit,
    allowed_class_extension = 0,
    allowed_student_extension = 0,
    max_buildings = excluded.max_buildings,
    max_stages = excluded.max_stages,
    expires_at = case when p_keep_expiry then subscription_profiles.expires_at else excluded.expires_at end,
    updated_by_platform = true,
    updated_at = now();

  insert into account_features (account_id, feature_key, enabled, note)
  select p_account, f, true, left('باقة: ' || pl.name_ar, 200) from unnest(pl.features) as f
  on conflict (account_id, feature_key) do update set enabled = true, note = excluded.note;

  return jsonb_build_object('plan', pl.key, 'name', pl.name_ar, 'features', pl.features,
    'expires_at', (select expires_at from subscription_profiles where account_id = p_account));
end $$;

revoke all on function apply_plan_to_account(uuid, text, boolean) from public, anon;
grant execute on function apply_plan_to_account(uuid, text, boolean) to authenticated, service_role;

-- باقات مبدئية تطابق الحدود الافتراضية الحالية (يعدّلها المالك من لوحة المنصة)
insert into plans (key, name_ar, description, account_type, class_limit, students_per_class, total_students, max_buildings, max_stages, features, duration_days, sort_order) values
  ('solo_free', 'معلّم مستقل — مجاني', 'حساب فردي بالحدود الأساسية', 'solo_teacher', 6, 30, 150, 1, 3, '{}', null, 10),
  ('school_standard', 'مدرسة — أساسية', 'مدرسة بكل ميزات التقييم، بلا مراسلات واتساب', 'school_enterprise', 200, 100, 5000, 10, 20, '{}', null, 20),
  ('school_whatsapp', 'مدرسة — مع مراسلات واتساب', 'الباقة الأساسية مع إضافة مراسلات أولياء الأمور', 'school_enterprise', 200, 100, 5000, 10, 20, '{whatsapp_notifications}', null, 30)
on conflict (key) do nothing;

reset search_path;
