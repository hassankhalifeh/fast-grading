-- 40: سجل محادثات واتساب الدائم. كل رسالة صادرة أو واردة تُوثَّق مع الرقم الذي استُعمل وقتها، ولا تتأثر بتغيير رقم المدرسة لاحقاً.
-- السجل لا يُعدَّل ولا يُحذف (باستثناء حالة التسليم)، وحذف مدرسة لها سجل مرفوض ما لم يُفعَّل تطهير صريح من المالك.

-- ===== تاريخ أرقام المدرسة =====
create table if not exists public.whatsapp_number_history (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete restrict,
  phone_number_id text not null,
  waba_id         text,
  display_phone   text,
  verified_name   text,
  active_from     timestamptz not null default now(),
  active_to       timestamptz,
  changed_by      uuid
);
create index if not exists whatsapp_number_history_acc_idx on public.whatsapp_number_history (account_id, active_from desc);
alter table public.whatsapp_number_history enable row level security;
revoke all on public.whatsapp_number_history from anon, authenticated;
grant select on public.whatsapp_number_history to authenticated;
drop policy if exists whatsapp_number_history_read on public.whatsapp_number_history;
create policy whatsapp_number_history_read on public.whatsapp_number_history for select to authenticated
  using (account_id = current_account_id() and (has_capability('config.manage') or has_capability('notifications.send') or has_capability('notifications.approve')));

-- ===== دفتر الرسائل =====
create table if not exists public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete restrict,
  direction           text not null check (direction in ('out', 'in')),
  channel_mode        text not null check (channel_mode in ('api', 'manual', 'inbound')),
  our_phone_number_id text,
  our_display_phone   text,
  contact_phone       text not null,
  student_id          uuid references public.students(id) on delete set null,
  student_name        text,
  msg_type            text not null default 'text',
  body                text,
  wa_message_id       text,
  status              text,
  error_text          text,
  notification_id     uuid,
  batch_id            uuid,
  occurred_at         timestamptz not null default now(),
  delivered_at        timestamptz,
  read_at             timestamptz
);
create index if not exists whatsapp_messages_thread_idx on public.whatsapp_messages (account_id, contact_phone, occurred_at);
create index if not exists whatsapp_messages_time_idx on public.whatsapp_messages (account_id, occurred_at desc);
create unique index if not exists whatsapp_messages_wa_id_uq on public.whatsapp_messages (account_id, wa_message_id, direction) where wa_message_id is not null;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;
drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated
  using (account_id = current_account_id() and (has_capability('config.manage') or has_capability('notifications.send') or has_capability('notifications.approve')));

-- لا تعديل على هوية الرسالة ولا نصها؛ فقط حالة التسليم. ولا حذف إلا بتطهير صريح (app.allow_purge) من المالك.
create or replace function public.tg_whatsapp_messages_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.allow_purge', true), '') = '1' then return old; end if;
    raise exception 'سجل محادثات واتساب دائم ولا يمكن حذفه';
  end if;
  if new.account_id is distinct from old.account_id or new.direction is distinct from old.direction
     or new.channel_mode is distinct from old.channel_mode or new.our_phone_number_id is distinct from old.our_phone_number_id
     or new.our_display_phone is distinct from old.our_display_phone or new.contact_phone is distinct from old.contact_phone
     or new.body is distinct from old.body or new.msg_type is distinct from old.msg_type or new.occurred_at is distinct from old.occurred_at
     or new.notification_id is distinct from old.notification_id or new.batch_id is distinct from old.batch_id
     or (old.wa_message_id is not null and new.wa_message_id is distinct from old.wa_message_id) then
    raise exception 'سجل محادثات واتساب لا يُعدَّل';
  end if;
  return new;
end $$;
drop trigger if exists whatsapp_messages_guard on public.whatsapp_messages;
create trigger whatsapp_messages_guard before update or delete on public.whatsapp_messages
  for each row execute function public.tg_whatsapp_messages_guard();
revoke all on function public.tg_whatsapp_messages_guard() from public, anon, authenticated;

-- ===== توثيق كل رسالة صادرة تلقائياً عند تغيّر حالتها إلى مُرسلة/فاشلة =====
create or replace function public.tg_log_outbound_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.account_whatsapp_config; v_name text;
begin
  if new.channel <> 'whatsapp' or new.status not in ('sent', 'failed') or new.status is not distinct from old.status then return new; end if;
  select * into c from public.account_whatsapp_config where account_id = new.account_id;
  select full_name into v_name from public.students where id = new.student_id;
  insert into public.whatsapp_messages (
    account_id, direction, channel_mode, our_phone_number_id, our_display_phone, contact_phone, student_id, student_name,
    body, wa_message_id, status, error_text, notification_id, batch_id, occurred_at
  ) values (
    new.account_id, 'out', case when new.provider_message_id is not null then 'api' else 'manual' end,
    c.phone_number_id, c.display_phone, coalesce(new.to_phone, ''), new.student_id, v_name,
    new.rendered_message, new.provider_message_id, case when new.status = 'sent' then coalesce(new.delivery_status, 'sent') else 'failed' end,
    new.error_text, new.id, new.batch_id, coalesce(new.sent_at, now())
  ) on conflict do nothing;
  return new;
end $$;
drop trigger if exists notifications_log_ledger on public.notifications_log;
create trigger notifications_log_ledger after update on public.notifications_log
  for each row execute function public.tg_log_outbound_message();
revoke all on function public.tg_log_outbound_message() from public, anon, authenticated;

-- ===== تحديث تخزين البيانات: يحتفظ بتاريخ الأرقام عند تغييرها =====
drop function if exists public.wa_store_credentials(uuid, text, text, text, text, text, text);
create or replace function public.wa_store_credentials(
  p_account uuid, p_phone_id text, p_waba text, p_token text, p_app_secret text, p_display text, p_name text, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.account_whatsapp_config; v_tok uuid; v_app uuid;
begin
  insert into public.account_whatsapp_config (account_id) values (p_account) on conflict do nothing;
  select * into v_row from public.account_whatsapp_config where account_id = p_account;

  v_tok := v_row.token_secret_id;
  if p_token is not null then
    if v_tok is null then v_tok := vault.create_secret(p_token, 'wa_token_' || p_account, 'WhatsApp token');
    else perform vault.update_secret(v_tok, p_token); end if;
  end if;
  v_app := v_row.app_secret_id;
  if p_app_secret is not null then
    if v_app is null then v_app := vault.create_secret(p_app_secret, 'wa_appsecret_' || p_account, 'WhatsApp app secret');
    else perform vault.update_secret(v_app, p_app_secret); end if;
  end if;

  -- تاريخ الأرقام: عند تغيير الرقم يُغلق السجل السابق ويُفتح جديد (لا يُحذف شيء)
  if v_row.phone_number_id is distinct from p_phone_id then
    update public.whatsapp_number_history set active_to = now() where account_id = p_account and active_to is null;
    insert into public.whatsapp_number_history (account_id, phone_number_id, waba_id, display_phone, verified_name, changed_by)
    values (p_account, p_phone_id, p_waba, p_display, p_name, p_actor);
  else
    update public.whatsapp_number_history set display_phone = coalesce(p_display, display_phone), verified_name = coalesce(p_name, verified_name), waba_id = coalesce(p_waba, waba_id)
    where account_id = p_account and active_to is null;
  end if;

  update public.account_whatsapp_config set
    phone_number_id = p_phone_id, waba_id = p_waba, token_secret_id = v_tok, app_secret_id = v_app,
    display_phone = p_display, verified_name = p_name, status = 'verified', last_error = null, last_checked_at = now(), updated_at = now()
  where account_id = p_account;
end $$;
revoke all on function public.wa_store_credentials(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.wa_store_credentials(uuid, text, text, text, text, text, text, uuid) to service_role;

-- ===== تسجيل الرسائل الواردة (للخدمة فقط: Webhook) =====
create or replace function public.wa_log_inbound(
  p_account uuid, p_our_phone_id text, p_our_display text, p_contact text, p_wa_id text, p_type text, p_body text, p_at timestamptz
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sid uuid; v_name text; v_n int;
begin
  -- ربط بطالب عبر آخر 8 أرقام من هاتف ولي الأمر إن كان التطابق وحيداً
  select count(*), min(s.id::text)::uuid, min(s.full_name) into v_n, v_sid, v_name
  from public.students s
  where s.account_id = p_account and s.parent_phone is not null
    and right(regexp_replace(s.parent_phone, '\D', '', 'g'), 8) = right(regexp_replace(p_contact, '\D', '', 'g'), 8);
  if v_n <> 1 then v_sid := null; v_name := null; end if;

  insert into public.whatsapp_messages (
    account_id, direction, channel_mode, our_phone_number_id, our_display_phone, contact_phone, student_id, student_name,
    msg_type, body, wa_message_id, status, occurred_at
  ) values (p_account, 'in', 'inbound', p_our_phone_id, p_our_display, p_contact, v_sid, v_name, coalesce(p_type, 'text'), p_body, p_wa_id, 'received', coalesce(p_at, now()))
  on conflict do nothing;
end $$;
revoke all on function public.wa_log_inbound(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.wa_log_inbound(uuid, text, text, text, text, text, text, timestamptz) to service_role;

-- ===== تحديث حالة التسليم في الدفتر (للخدمة فقط) =====
create or replace function public.wa_update_delivery(p_account uuid, p_wa_id text, p_status text, p_at timestamptz, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.whatsapp_messages set
    status = p_status,
    delivered_at = case when p_status = 'delivered' then coalesce(p_at, now()) else delivered_at end,
    read_at = case when p_status = 'read' then coalesce(p_at, now()) else read_at end,
    error_text = case when p_status = 'failed' then left(p_error, 300) else error_text end
  where account_id = p_account and wa_message_id = p_wa_id and direction = 'out';
$$;
revoke all on function public.wa_update_delivery(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.wa_update_delivery(uuid, text, text, timestamptz, text) to service_role;

-- ===== ترحيل الرقم الحالي (إن وُجد) إلى التاريخ =====
insert into public.whatsapp_number_history (account_id, phone_number_id, waba_id, display_phone, verified_name)
select c.account_id, c.phone_number_id, c.waba_id, c.display_phone, c.verified_name
from public.account_whatsapp_config c
where c.phone_number_id is not null
  and not exists (select 1 from public.whatsapp_number_history h where h.account_id = c.account_id and h.active_to is null);
