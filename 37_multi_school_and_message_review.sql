-- 37: جاهزية تعدد المدارس + قوالب رسائل قابلة للتعديل لكل مدرسة + مراجعة/اعتماد إلزامي قبل أي إرسال + مدير المنصة

-- ============ صلاحية جديدة: اعتماد الرسائل ============
insert into public.capabilities (key, label_ar, category)
values ('notifications.approve', 'مراجعة واعتماد الرسائل قبل إرسالها لأولياء الأمور', 'Admin')
on conflict (key) do nothing;

insert into public.user_capabilities (app_user_id, capability_key)
select u.id, 'notifications.approve' from public.app_users u
where u.role in ('solo_teacher', 'school_admin')
  and not exists (select 1 from public.user_capabilities c where c.app_user_id = u.id and c.capability_key = 'notifications.approve');

create or replace function public.apply_default_capabilities(p_app_user_id uuid, p_role user_role_enum)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  delete from user_capabilities where app_user_id = p_app_user_id;

  if p_role = 'solo_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    select p_app_user_id, key from capabilities;
  elsif p_role = 'school_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'window.toggle'),
           (p_app_user_id, 'reports.view'), (p_app_user_id, 'reports.export'),
           (p_app_user_id, 'config.manage'), (p_app_user_id, 'users.manage'),
           (p_app_user_id, 'notifications.send'), (p_app_user_id, 'notifications.approve'), (p_app_user_id, 'roster.manage'),
           (p_app_user_id, 'grading.adjust'), (p_app_user_id, 'teaching.approve_secondary'),
           (p_app_user_id, 'supplementary.manage'), (p_app_user_id, 'records.import_manage'),
           (p_app_user_id, 'grades.finalize_submission'), (p_app_user_id, 'grades.edit_others'),
           (p_app_user_id, 'building.manage');
  elsif p_role = 'assistant_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter'), (p_app_user_id, 'grades.edit_others'),
           (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'roster.manage');
  elsif p_role = 'subject_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter');
  elsif p_role = 'custom_role' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'reports.view');
  end if;
end;
$function$;

-- ============ معلومات المدرسة (ما يختلف من مدرسة لأخرى) ============
create table if not exists public.school_settings (
  account_id     uuid primary key references public.accounts(id) on delete cascade,
  principal_name text,
  phone          text,
  email          text,
  address        text,
  country_code   text not null default '961' check (country_code ~ '^[0-9]{1,4}$'),
  report_footer  text,
  approval_mode  text not null default 'self' check (approval_mode in ('self', 'other')),
  updated_at     timestamptz not null default now()
);
alter table public.school_settings enable row level security;
revoke all on public.school_settings from anon;

drop policy if exists school_settings_read on public.school_settings;
create policy school_settings_read on public.school_settings for select to authenticated
  using (account_id = current_account_id());
drop policy if exists school_settings_insert on public.school_settings;
create policy school_settings_insert on public.school_settings for insert to authenticated
  with check (account_id = current_account_id() and has_capability('config.manage'));
drop policy if exists school_settings_update on public.school_settings;
create policy school_settings_update on public.school_settings for update to authenticated
  using (account_id = current_account_id() and has_capability('config.manage'))
  with check (account_id = current_account_id() and has_capability('config.manage'));

insert into public.school_settings (account_id) select id from public.accounts on conflict do nothing;

create or replace function public.tg_accounts_default_settings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.school_settings (account_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists accounts_default_settings on public.accounts;
create trigger accounts_default_settings after insert on public.accounts
  for each row execute function public.tg_accounts_default_settings();

-- اسم المدرسة يعيش في accounts.display_name؛ تعديله عبر دالة مقيّدة بالصلاحية
create or replace function public.update_school_name(p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_capability('config.manage') then raise exception 'ليس لديك صلاحية تعديل إعدادات المدرسة'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'اسم المدرسة مطلوب'; end if;
  update public.accounts set display_name = trim(p_name) where id = current_account_id();
end $$;
revoke all on function public.update_school_name(text) from public, anon;
grant execute on function public.update_school_name(text) to authenticated;

-- ============ قوالب الرسائل: صياغة خاصة لكل مدرسة ولكل نوع مراسلة ============
alter table public.notification_templates
  add column if not exists message_type text not null default 'custom',
  add column if not exists wa_template_name text,
  add column if not exists wa_language text not null default 'ar',
  add column if not exists wa_status text not null default 'none',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid;
alter table public.notification_templates drop constraint if exists notification_templates_wa_status_chk;
alter table public.notification_templates add constraint notification_templates_wa_status_chk
  check (wa_status in ('none', 'submitted', 'approved', 'rejected'));
create unique index if not exists notification_templates_type_uq
  on public.notification_templates (account_id, message_type) where message_type <> 'custom';

-- تعديل النص يُبطل اعتماد واتساب السابق (كل صياغة جديدة تحتاج اعتماداً جديداً)
create or replace function public.tg_template_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.body_template is distinct from old.body_template and new.wa_status in ('submitted', 'approved') then
    new.wa_status := 'none';
  end if;
  return new;
end $$;
drop trigger if exists notification_templates_touch on public.notification_templates;
create trigger notification_templates_touch before update on public.notification_templates
  for each row execute function public.tg_template_touch();

drop policy if exists notification_templates_insert on public.notification_templates;
drop policy if exists notification_templates_update on public.notification_templates;
drop policy if exists notification_templates_delete on public.notification_templates;
create policy notification_templates_insert on public.notification_templates for insert to authenticated
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('config.manage'));
create policy notification_templates_update on public.notification_templates for update to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('config.manage'))
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('config.manage'));
create policy notification_templates_delete on public.notification_templates for delete to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('config.manage'));

-- ============ دفعات الرسائل: مسودة ← مراجعة ← اعتماد ← إرسال ============
create table if not exists public.notification_batches (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  message_type text not null,
  title        text not null,
  exam_id      uuid references public.exams(id) on delete set null,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'cancelled')),
  created_by   uuid not null references public.app_users(id),
  approved_by  uuid references public.app_users(id),
  approved_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now()
);
create index if not exists notification_batches_account_idx on public.notification_batches (account_id, created_at desc);
alter table public.notification_batches enable row level security;
revoke all on public.notification_batches from anon;

drop policy if exists notification_batches_read on public.notification_batches;
create policy notification_batches_read on public.notification_batches for select to authenticated
  using (account_id = current_account_id());
drop policy if exists notification_batches_insert on public.notification_batches;
create policy notification_batches_insert on public.notification_batches for insert to authenticated
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications')
              and has_capability('notifications.send') and status = 'draft' and created_by = current_app_user_id());
drop policy if exists notification_batches_update on public.notification_batches;
create policy notification_batches_update on public.notification_batches for update to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications')
         and (has_capability('notifications.send') or has_capability('notifications.approve')))
  with check (account_id = current_account_id());

create or replace function public.tg_guard_notification_batch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.account_id is distinct from old.account_id or new.created_by is distinct from old.created_by
     or new.message_type is distinct from old.message_type or new.exam_id is distinct from old.exam_id then
    raise exception 'لا يمكن تغيير بيانات الدفعة الأساسية';
  end if;
  if auth.uid() is null then return new; end if; -- عمليات المالك/الخدمة

  if old.status <> 'draft' then
    if not (old.status = 'approved' and new.status = 'cancelled' and has_capability('notifications.approve')) then
      raise exception 'الدفعة معتمدة/مغلقة ولا يمكن تعديلها';
    end if;
  elsif new.status <> 'draft' then
    if new.status not in ('approved', 'rejected') then raise exception 'انتقال غير مسموح'; end if;
    if not has_capability('notifications.approve') then raise exception 'ليس لديك صلاحية اعتماد الرسائل'; end if;
    if new.status = 'approved' then
      if coalesce((select approval_mode from public.school_settings where account_id = old.account_id), 'self') = 'other'
         and old.created_by = current_app_user_id() then
        raise exception 'إعدادات المدرسة تشترط أن يعتمد الدفعة شخص آخر غير من أعدّها';
      end if;
      if not exists (select 1 from public.notifications_log l where l.batch_id = old.id and l.included) then
        raise exception 'لا توجد رسائل محددة للإرسال في هذه الدفعة';
      end if;
      new.approved_by := current_app_user_id();
      new.approved_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists notification_batches_guard on public.notification_batches;
create trigger notification_batches_guard before update on public.notification_batches
  for each row execute function public.tg_guard_notification_batch();

-- ============ الرسائل داخل الدفعة ============
alter table public.notifications_log
  add column if not exists included boolean not null default true,
  add column if not exists edited boolean not null default false,
  add column if not exists message_type text;
alter table public.notifications_log drop constraint if exists notifications_log_batch_fk;
alter table public.notifications_log add constraint notifications_log_batch_fk
  foreign key (batch_id) references public.notification_batches(id) on delete cascade;

drop policy if exists notifications_insert on public.notifications_log;
drop policy if exists notifications_update on public.notifications_log;
drop policy if exists notifications_delete on public.notifications_log;
create policy notifications_insert on public.notifications_log for insert to authenticated
  with check (
    account_id = current_account_id()
    and account_has_feature('whatsapp_notifications')
    and has_capability('notifications.send')
    and exists (select 1 from public.students s where s.id = student_id)
    and exists (select 1 from public.notification_batches b where b.id = batch_id and b.account_id = account_id and b.status = 'draft')
  );
create policy notifications_update on public.notifications_log for update to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications')
         and (has_capability('notifications.send') or has_capability('notifications.approve')))
  with check (account_id = current_account_id());
create policy notifications_delete on public.notifications_log for delete to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications')
         and (has_capability('notifications.send') or has_capability('notifications.approve'))
         and exists (select 1 from public.notification_batches b where b.id = batch_id and b.status = 'draft'));

create or replace function public.tg_guard_notification_row() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_status text;
begin
  if auth.uid() is null then return new; end if; -- الخدمة (Webhook/Edge Function) موثوقة
  select status into v_status from public.notification_batches where id = old.batch_id;
  if v_status = 'draft' then
    if new.status is distinct from old.status or new.claimed_at is distinct from old.claimed_at
       or new.provider_message_id is distinct from old.provider_message_id or new.sent_at is distinct from old.sent_at then
      raise exception 'الرسالة ضمن مسودة: لا يمكن الإرسال قبل الاعتماد';
    end if;
    if new.rendered_message is distinct from old.rendered_message then
      new.edited := true;           -- تعديل استثنائي: يخرج من القالب المعتمد لدى واتساب ويُرسل يدوياً
      new.wa_template_name := null;
      new.wa_params := null;
    end if;
  else
    if new.rendered_message is distinct from old.rendered_message or new.to_phone is distinct from old.to_phone
       or new.student_id is distinct from old.student_id or new.included is distinct from old.included
       or new.wa_template_name is distinct from old.wa_template_name or new.wa_params is distinct from old.wa_params then
      raise exception 'الرسالة معتمدة ومجمّدة ولا يمكن تعديلها';
    end if;
    if new.status is distinct from old.status and v_status is distinct from 'approved' then
      raise exception 'الدفعة غير معتمدة';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists notifications_log_guard on public.notifications_log;
create trigger notifications_log_guard before update on public.notifications_log
  for each row execute function public.tg_guard_notification_row();

-- ============ مدير المنصة (أنت): إنشاء المدارس وتفعيل الإضافات ============
create table if not exists public.platform_admins (
  auth_uid   uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where auth_uid = auth.uid());
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
