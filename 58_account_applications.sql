-- 58_account_applications.sql
-- طلب فتح حساب: صفحة عامة (/apply) يملؤها أي مدرسة أو معلّم مستقل، فيصل الطلب إلى مالك المنصة ليعتمده أو يرفضه من /platform.
--
-- الجدول مغلق على العموم: لا قراءة ولا كتابة مباشرة لـanon/authenticated إلا لمالك المنصة (RLS).
-- الإرسال العام يمرّ حصراً عبر submit_account_application (SECURITY DEFINER) وفيها:
--   * حقل مصيدة (honeypot) يتجاهل الروبوتات بصمت،
--   * تحقق من الأطوال والبريد ونوع الحساب والباقة،
--   * حد معدّل: 5 طلبات/ساعة لكل عنوان IP (مخزَّن مُشفَّراً md5 لا خاماً) و100 طلب/ساعة إجمالاً،
--   * استجابة موحَّدة لا تكشف إن كان البريد مسجَّلاً أو له طلب سابق (منع تعداد الحسابات)؛ المالك وحده يرى علامة «البريد مسجَّل».
-- لا دفع هنا (مؤجَّل لما بعد الإطلاق): الطلب يحدّد الباقة المرغوبة فقط والمالك يقرّر.
set search_path to fastgrading;

create table if not exists account_applications (
  id                 uuid primary key default gen_random_uuid(),
  account_type       text not null check (account_type in ('school_enterprise', 'solo_teacher')),
  org_name           text not null check (length(trim(org_name)) between 2 and 120),
  contact_name       text not null check (length(trim(contact_name)) between 2 and 120),
  email              text not null check (length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text check (phone is null or length(phone) <= 40),
  country            text check (country is null or length(country) <= 60),
  plan_key           text,
  student_count      integer check (student_count is null or student_count between 0 and 1000000),
  message            text check (message is null or length(message) <= 1000),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  email_registered   boolean not null default false,
  decision_note      text check (decision_note is null or length(decision_note) <= 500),
  decided_at         timestamptz,
  created_account_id uuid references accounts(id) on delete set null,
  ip_hash            text,
  created_at         timestamptz not null default now()
);
create index if not exists account_applications_status_idx on account_applications (status, created_at desc);
create index if not exists account_applications_email_idx on account_applications (lower(email));
create index if not exists account_applications_ip_idx on account_applications (ip_hash, created_at) where ip_hash is not null;

alter table account_applications enable row level security;
drop policy if exists account_applications_platform_admin on account_applications;
create policy account_applications_platform_admin on account_applications for all
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on account_applications from anon, authenticated;
grant select, update on account_applications to authenticated;
grant all on account_applications to service_role;

-- الباقات المتاحة للعرض على الصفحة العامة (المفعّلة فقط، بلا أي حقل داخلي)
create or replace function list_public_plans() returns jsonb
language sql stable security definer set search_path to 'fastgrading', 'pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p.key, 'name', p.name_ar, 'description', p.description, 'account_type', p.account_type,
    'class_limit', p.class_limit, 'students_per_class', p.students_per_class, 'total_students', p.total_students,
    'max_buildings', p.max_buildings, 'max_stages', p.max_stages, 'features', p.features, 'duration_days', p.duration_days
  ) order by p.sort_order, p.name_ar), '[]'::jsonb)
  from plans p where p.is_active;
$$;
revoke all on function list_public_plans() from public;
grant execute on function list_public_plans() to anon, authenticated, service_role;

create or replace function submit_account_application(
  p_account_type text, p_org_name text, p_contact_name text, p_email text, p_phone text default null,
  p_country text default null, p_plan_key text default null, p_student_count integer default null,
  p_message text default null, p_website text default ''
) returns jsonb
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text; v_hash text; v_plan text := nullif(trim(coalesce(p_plan_key, '')), '');
begin
  -- مصيدة الروبوتات: حقل مخفي يملؤه الآلي فقط، نُرجع نجاحاً شكلياً دون إدراج
  if coalesce(p_website, '') <> '' then return jsonb_build_object('ok', true); end if;

  if p_account_type is null or p_account_type not in ('school_enterprise', 'solo_teacher') then raise exception 'نوع الحساب غير صالح'; end if;
  if length(trim(coalesce(p_org_name, ''))) < 2 then raise exception 'اسم المدرسة أو الحساب مطلوب'; end if;
  if length(trim(coalesce(p_contact_name, ''))) < 2 then raise exception 'اسم المسؤول مطلوب'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'بريد إلكتروني غير صالح'; end if;
  if length(coalesce(p_org_name, '')) > 120 or length(coalesce(p_contact_name, '')) > 120 or length(coalesce(p_phone, '')) > 40
     or length(coalesce(p_country, '')) > 60 or length(coalesce(p_message, '')) > 1000 then raise exception 'أحد الحقول أطول من المسموح'; end if;
  if p_student_count is not null and (p_student_count < 0 or p_student_count > 1000000) then raise exception 'عدد الطلاب غير صالح'; end if;
  if v_plan is not null and not exists (select 1 from plans where key = v_plan and is_active) then raise exception 'الباقة المختارة غير متاحة'; end if;

  v_ip := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1);
  v_hash := case when trim(v_ip) = '' then null else md5('fg-apply:' || trim(v_ip)) end;
  if v_hash is not null and (select count(*) from account_applications where ip_hash = v_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'محاولات كثيرة، أعد المحاولة لاحقاً';
  end if;
  if (select count(*) from account_applications where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'محاولات كثيرة، أعد المحاولة لاحقاً';
  end if;

  -- طلب معلّق سابق لنفس البريد: لا نكرّره ولا نخبر المرسل بذلك
  if exists (select 1 from account_applications where lower(email) = v_email and status = 'pending') then
    return jsonb_build_object('ok', true);
  end if;

  insert into account_applications (account_type, org_name, contact_name, email, phone, country, plan_key, student_count, message, email_registered, ip_hash)
  values (p_account_type, trim(p_org_name), trim(p_contact_name), v_email, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_country, '')), ''),
          v_plan, p_student_count, nullif(trim(coalesce(p_message, '')), ''),
          exists (select 1 from app_users where lower(email) = v_email), v_hash);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function submit_account_application(text, text, text, text, text, text, text, integer, text, text) from public;
grant execute on function submit_account_application(text, text, text, text, text, text, text, integer, text, text) to anon, authenticated, service_role;

reset search_path;
