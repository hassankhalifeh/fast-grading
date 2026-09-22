-- 45: حدود الحساب وتاريخ الانتهاء لكل مدرسة/حساب (يديرها مالك المنصة من /platform).
-- يوسّع subscription_profiles الموجود أصلاً (كان يخدم حسابات solo_teacher فقط) ليشمل كل أنواع الحسابات،
-- ويضيف حد المباني (الفروع) وحد المراحل وتاريخ انتهاء الاشتراك، ويفرض الكل في قاعدة البيانات.

alter table public.subscription_profiles
  add column if not exists max_buildings integer not null default 1,
  add column if not exists max_stages    integer not null default 20,
  add column if not exists expires_at    timestamptz,
  add column if not exists notes         text,
  add column if not exists updated_by_platform boolean not null default false;
alter table public.subscription_profiles drop constraint if exists subscription_profiles_status_chk;
alter table public.subscription_profiles add constraint subscription_profiles_status_chk check (status in ('active', 'suspended'));

-- إنشاء أي حساب جديد يحصل تلقائياً على سجل حدود افتراضي (سخي للمدارس، محدود للحساب الفردي كما كان سابقاً)
create or replace function public.tg_accounts_default_settings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.school_settings (account_id) values (new.id) on conflict do nothing;
  insert into public.subscription_profiles (account_id, plan_type, default_class_limit, default_student_per_class, default_total_student_limit, max_buildings, max_stages)
  values (
    new.id,
    case when new.account_type = 'solo_teacher' then 'solo_teacher_free' else 'school_custom' end,
    case when new.account_type = 'solo_teacher' then 6 else 200 end,
    case when new.account_type = 'solo_teacher' then 30 else 100 end,
    case when new.account_type = 'solo_teacher' then 150 else 5000 end,
    case when new.account_type = 'solo_teacher' then 1 else 10 end,
    case when new.account_type = 'solo_teacher' then 3 else 20 end
  ) on conflict (account_id) do nothing;
  return new;
end $$;

-- تعبئة الحسابات القديمة التي لا تملك سجل حدود بعد (سخي، بلا انتهاء) دون المساس بالحساب الذي له سجل أصلاً
insert into public.subscription_profiles (account_id, plan_type, default_class_limit, default_student_per_class, default_total_student_limit, max_buildings, max_stages)
select a.id, case when a.account_type = 'solo_teacher' then 'solo_teacher_free' else 'school_custom' end,
       case when a.account_type = 'solo_teacher' then 6 else 200 end,
       case when a.account_type = 'solo_teacher' then 30 else 100 end,
       case when a.account_type = 'solo_teacher' then 150 else 5000 end,
       case when a.account_type = 'solo_teacher' then 1 else 10 end,
       case when a.account_type = 'solo_teacher' then 3 else 20 end
from public.accounts a
where not exists (select 1 from public.subscription_profiles sp where sp.account_id = a.id);

-- هل الاشتراك فعّال؟ (نشط ولم ينته تاريخه). حساب بلا سجل حدود يُعامَل كمفعّل توافقياً.
create or replace function public.account_subscription_ok(p_account uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select sp.status = 'active' and (sp.expires_at is null or sp.expires_at > now())
     from public.subscription_profiles sp where sp.account_id = coalesce(p_account, public.current_account_id())),
    true
  );
$$;
revoke all on function public.account_subscription_ok(uuid) from public, anon;
grant execute on function public.account_subscription_ok(uuid) to authenticated, service_role;

-- حالة الاشتراك والاستعمال الحالي مقابل الحدود، لعرضها للمستخدم (بلا أسرار)
create or replace function public.my_subscription_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_acc uuid := public.current_account_id(); sp public.subscription_profiles; v_classes int; v_students int; v_buildings int; v_stages int;
begin
  select * into sp from public.subscription_profiles where account_id = v_acc;
  select count(*) into v_classes from public.class_sections where account_id = v_acc and is_active = true;
  select count(distinct ce.student_id) into v_students from public.class_enrollments ce join public.class_sections cs on cs.id = ce.class_section_id where cs.account_id = v_acc and ce.status = 'active';
  select count(*) into v_buildings from public.buildings where account_id = v_acc;
  select count(*) into v_stages from public.stages where account_id = v_acc;
  if sp.account_id is null then
    return jsonb_build_object('ok', true, 'status', 'active', 'expires_at', null, 'days_left', null);
  end if;
  return jsonb_build_object(
    'ok', public.account_subscription_ok(v_acc), 'status', sp.status, 'plan_type', sp.plan_type,
    'expires_at', sp.expires_at, 'days_left', case when sp.expires_at is null then null else ceil(extract(epoch from (sp.expires_at - now())) / 86400) end,
    'limits', jsonb_build_object('classes', sp.default_class_limit + sp.allowed_class_extension, 'students_per_class', sp.default_student_per_class,
      'total_students', sp.default_total_student_limit + sp.allowed_student_extension, 'buildings', sp.max_buildings, 'stages', sp.max_stages),
    'usage', jsonb_build_object('classes', v_classes, 'students', v_students, 'buildings', v_buildings, 'stages', v_stages)
  );
end $$;
revoke all on function public.my_subscription_status() from public, anon;
grant execute on function public.my_subscription_status() to authenticated;

-- تعميم حد الصفوف على كل أنواع الحسابات (كان مقصوراً على solo_teacher)
create or replace function public.enforce_solo_class_limit() returns trigger
language plpgsql set search_path to 'public' as $function$
declare
  v_default_limit  integer;
  v_extension      integer;
  v_current_count  integer;
begin
  if not public.account_subscription_ok(new.account_id) then
    raise exception using errcode = 'P0003', message = 'انتهت صلاحية اشتراك المدرسة أو أُوقف الحساب. تواصل مع إدارة المنصة لتجديده.';
  end if;

  select sp.default_class_limit, sp.allowed_class_extension into v_default_limit, v_extension
  from subscription_profiles sp where sp.account_id = new.account_id for update;
  if v_default_limit is null then return new; end if;

  select count(*) into v_current_count from class_sections where account_id = new.account_id and is_active = true;
  if (v_current_count + 1) > (v_default_limit + v_extension) then
    raise exception using errcode = 'P0001',
      message = 'Limit reached. Please contact support for an exceptional paid extension or upgrade to the Institutional School Plan.';
  end if;
  return new;
end;
$function$;

-- تعميم حد الطلاب على كل أنواع الحسابات
create or replace function public.enforce_solo_student_limits() returns trigger
language plpgsql set search_path to 'public' as $function$
declare
  v_account_id              uuid;
  v_default_per_class       integer;
  v_default_total           integer;
  v_student_extension       integer;
  v_per_class_count         integer;
  v_total_distinct_count    integer;
  v_student_already_counted boolean;
begin
  select cs.account_id into v_account_id from class_sections cs where cs.id = new.class_section_id;

  if not public.account_subscription_ok(v_account_id) then
    raise exception using errcode = 'P0003', message = 'انتهت صلاحية اشتراك المدرسة أو أُوقف الحساب. تواصل مع إدارة المنصة لتجديده.';
  end if;

  select sp.default_student_per_class, sp.default_total_student_limit, sp.allowed_student_extension
    into v_default_per_class, v_default_total, v_student_extension
  from subscription_profiles sp where sp.account_id = v_account_id for update;
  if v_default_per_class is null then return new; end if;

  select count(*) into v_per_class_count from class_enrollments where class_section_id = new.class_section_id and status = 'active';
  if (v_per_class_count + 1) > v_default_per_class then
    raise exception using errcode = 'P0001',
      message = 'Limit reached. Please contact support for an exceptional paid extension or upgrade to the Institutional School Plan.';
  end if;

  select exists (
    select 1 from class_enrollments ce join class_sections cs2 on cs2.id = ce.class_section_id
    where cs2.account_id = v_account_id and ce.student_id = new.student_id and ce.status = 'active'
  ) into v_student_already_counted;

  if not v_student_already_counted then
    select count(distinct ce.student_id) into v_total_distinct_count
    from class_enrollments ce join class_sections cs2 on cs2.id = ce.class_section_id
    where cs2.account_id = v_account_id and ce.status = 'active';
    if (v_total_distinct_count + 1) > (v_default_total + v_student_extension) then
      raise exception using errcode = 'P0001',
        message = 'Limit reached. Please contact support for an exceptional paid extension or upgrade to the Institutional School Plan.';
    end if;
  end if;
  return new;
end;
$function$;

-- حد المباني (الفروع)
create or replace function public.enforce_building_limit() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_limit int; v_count int;
begin
  if not public.account_subscription_ok(new.account_id) then
    raise exception using errcode = 'P0003', message = 'انتهت صلاحية اشتراك المدرسة أو أُوقف الحساب. تواصل مع إدارة المنصة لتجديده.';
  end if;
  select sp.max_buildings into v_limit from subscription_profiles sp where sp.account_id = new.account_id for update;
  if v_limit is null then return new; end if;
  select count(*) into v_count from buildings where account_id = new.account_id;
  if (v_count + 1) > v_limit then
    raise exception using errcode = 'P0001', message = 'بلغ عدد الفروع/المباني الحد المسموح به لهذا الحساب — تواصل مع إدارة المنصة لزيادته.';
  end if;
  return new;
end $$;
drop trigger if exists buildings_limit on public.buildings;
create trigger buildings_limit before insert on public.buildings
  for each row execute function public.enforce_building_limit();
revoke all on function public.enforce_building_limit() from public, anon, authenticated;

-- حد المراحل
create or replace function public.enforce_stage_limit() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_limit int; v_count int;
begin
  if not public.account_subscription_ok(new.account_id) then
    raise exception using errcode = 'P0003', message = 'انتهت صلاحية اشتراك المدرسة أو أُوقف الحساب. تواصل مع إدارة المنصة لتجديده.';
  end if;
  select sp.max_stages into v_limit from subscription_profiles sp where sp.account_id = new.account_id for update;
  if v_limit is null then return new; end if;
  select count(*) into v_count from stages where account_id = new.account_id;
  if (v_count + 1) > v_limit then
    raise exception using errcode = 'P0001', message = 'بلغ عدد المراحل الحد المسموح به لهذا الحساب — تواصل مع إدارة المنصة لزيادته.';
  end if;
  return new;
end $$;
drop trigger if exists stages_limit on public.stages;
create trigger stages_limit before insert on public.stages
  for each row execute function public.enforce_stage_limit();
revoke all on function public.enforce_stage_limit() from public, anon, authenticated;

-- انتهاء الاشتراك يمنع إدخال علامات جديدة (فوق فحص نافذة العلامات الموجود أصلاً)
create or replace function public.enforce_grading_window() returns trigger
language plpgsql set search_path to 'public' as $function$
declare
  v_account_id    uuid;
  v_account_type  account_type_enum;
  v_window_open   boolean;
begin
  select e.account_id, a.account_type, e.grading_window_open
    into v_account_id, v_account_type, v_window_open
  from exams e join accounts a on a.id = e.account_id
  where e.id = new.exam_id;

  if not public.account_subscription_ok(v_account_id) then
    raise exception using errcode = 'P0003', message = 'انتهت صلاحية اشتراك المدرسة أو أُوقف الحساب. تواصل مع إدارة المنصة لتجديده.';
  end if;

  if v_account_type = 'school_enterprise' and v_window_open = false then
    raise exception using
      errcode = 'P0002',
      message = 'The grading window is currently locked. Ask the General Supervisor to open it before entering marks.';
  end if;

  return new;
end;
$function$;

-- انتهاء الاشتراك يمنع أيضاً مراسلات واتساب الجديدة
drop policy if exists notification_batches_insert on public.notification_batches;
create policy notification_batches_insert on public.notification_batches for insert to authenticated
  with check (account_id = current_account_id() and whatsapp_active() and account_subscription_ok(account_id)
              and has_capability('notifications.send') and status = 'draft' and created_by = current_app_user_id());
