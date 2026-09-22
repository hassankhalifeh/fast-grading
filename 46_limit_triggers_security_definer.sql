-- 46: تصحيح: دوال حدود الحساب (صفوف/طلاب/مباني/مراحل/نافذة العلامات) لم تكن SECURITY DEFINER، فكانت قراءتها
-- لجدول subscription_profiles عبر "FOR UPDATE" تحت RLS لا تُقفل الصف فعلياً وتتجاوز الحد بصمت (اكتُشف بالاختبار).
-- كل دوال المُشغّلات الأخرى في هذا التطبيق SECURITY DEFINER؛ نطبّق نفس النمط هنا.

create or replace function public.enforce_solo_class_limit() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

create or replace function public.enforce_solo_student_limits() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

create or replace function public.enforce_building_limit() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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

create or replace function public.enforce_stage_limit() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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

create or replace function public.enforce_grading_window() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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

revoke all on function public.enforce_solo_class_limit() from public, anon, authenticated;
revoke all on function public.enforce_solo_student_limits() from public, anon, authenticated;
revoke all on function public.enforce_building_limit() from public, anon, authenticated;
revoke all on function public.enforce_stage_limit() from public, anon, authenticated;
revoke all on function public.enforce_grading_window() from public, anon, authenticated;
