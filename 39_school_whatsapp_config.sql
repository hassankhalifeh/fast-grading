-- 39: واتساب لكل مدرسة برقمها وحسابها لدى Meta. الاشتراك (account_features) يفعّله مالك المنصة، ومفتاح التشغيل والبيانات تدخلها إدارة المدرسة.
-- الأسرار (التوكن وApp Secret) تُخزَّن في Supabase Vault ولا تُقرأ من المتصفح إطلاقاً؛ لا يصل إليها إلا Edge Functions بمفتاح الخدمة.

create table if not exists public.account_whatsapp_config (
  account_id           uuid primary key references public.accounts(id) on delete cascade,
  enabled              boolean not null default true,
  phone_number_id      text,
  waba_id              text,
  display_phone        text,
  verified_name        text,
  token_secret_id      uuid,
  app_secret_id        uuid,
  webhook_verify_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status               text not null default 'not_configured' check (status in ('not_configured', 'verified', 'error')),
  last_error           text,
  last_checked_at      timestamptz,
  updated_at           timestamptz not null default now()
);
alter table public.account_whatsapp_config enable row level security;
revoke all on public.account_whatsapp_config from anon, authenticated;

-- المفعَّل فعلياً = مشتركة (منصة) + غير موقوفة من المدرسة. غياب الصف = غير موقوفة.
create or replace function public.whatsapp_active() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.account_has_feature('whatsapp_notifications')
     and coalesce((select c.enabled from public.account_whatsapp_config c where c.account_id = public.current_account_id()), true);
$$;
revoke all on function public.whatsapp_active() from public, anon;
grant execute on function public.whatsapp_active() to authenticated;

-- حالة الإعداد للمدرسة (بلا أي سر)
create or replace function public.get_whatsapp_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.account_whatsapp_config;
begin
  if not has_capability('config.manage') then raise exception 'ليس لديك صلاحية إعدادات المدرسة'; end if;
  if not account_has_feature('whatsapp_notifications') then return jsonb_build_object('entitled', false); end if;
  select * into c from public.account_whatsapp_config where account_id = current_account_id();
  return jsonb_build_object(
    'entitled', true,
    'enabled', coalesce(c.enabled, true),
    'phone_number_id', c.phone_number_id, 'waba_id', c.waba_id, 'display_phone', c.display_phone, 'verified_name', c.verified_name,
    'has_token', c.token_secret_id is not null, 'has_app_secret', c.app_secret_id is not null,
    'status', coalesce(c.status, 'not_configured'), 'last_error', c.last_error, 'last_checked_at', c.last_checked_at,
    'webhook_verify_token', c.webhook_verify_token, 'account_id', current_account_id()
  );
end $$;
revoke all on function public.get_whatsapp_status() from public, anon;
grant execute on function public.get_whatsapp_status() to authenticated;

-- تشغيل/إيقاف الخدمة من إدارة المدرسة (تعمل فقط للمشتركة)
create or replace function public.set_whatsapp_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_capability('config.manage') then raise exception 'ليس لديك صلاحية إعدادات المدرسة'; end if;
  if not account_has_feature('whatsapp_notifications') then raise exception 'الخدمة غير مشترك بها — تواصل مع إدارة المنصة'; end if;
  insert into public.account_whatsapp_config (account_id, enabled) values (current_account_id(), p_enabled)
  on conflict (account_id) do update set enabled = excluded.enabled, updated_at = now();
end $$;
revoke all on function public.set_whatsapp_enabled(boolean) from public, anon;
grant execute on function public.set_whatsapp_enabled(boolean) to authenticated;

-- ===== للخدمة فقط (Edge Functions بمفتاح الخدمة) =====
create or replace function public.wa_store_credentials(
  p_account uuid, p_phone_id text, p_waba text, p_token text, p_app_secret text, p_display text, p_name text
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

  update public.account_whatsapp_config set
    phone_number_id = p_phone_id, waba_id = p_waba, token_secret_id = v_tok, app_secret_id = v_app,
    display_phone = p_display, verified_name = p_name, status = 'verified', last_error = null, last_checked_at = now(), updated_at = now()
  where account_id = p_account;
end $$;

create or replace function public.wa_set_status(p_account uuid, p_status text, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.account_whatsapp_config set status = p_status, last_error = left(p_error, 300), last_checked_at = now(), updated_at = now()
  where account_id = p_account;
$$;

create or replace function public.wa_get_credentials(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enabled', c.enabled, 'status', c.status, 'phone_number_id', c.phone_number_id,
    'token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.token_secret_id),
    'app_secret', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.app_secret_id),
    'webhook_verify_token', c.webhook_verify_token
  ) from public.account_whatsapp_config c where c.account_id = p_account;
$$;

revoke all on function public.wa_store_credentials(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.wa_set_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.wa_get_credentials(uuid) from public, anon, authenticated;
grant execute on function public.wa_store_credentials(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.wa_set_status(uuid, text, text) to service_role;
grant execute on function public.wa_get_credentials(uuid) to service_role;

-- ===== سياسات المراسلات: تتطلب الآن الاشتراك + عدم إيقاف المدرسة للخدمة =====
drop policy if exists notification_templates_insert on public.notification_templates;
drop policy if exists notification_templates_update on public.notification_templates;
drop policy if exists notification_templates_delete on public.notification_templates;
create policy notification_templates_insert on public.notification_templates for insert to authenticated
  with check (account_id = current_account_id() and whatsapp_active() and has_capability('config.manage'));
create policy notification_templates_update on public.notification_templates for update to authenticated
  using (account_id = current_account_id() and whatsapp_active() and has_capability('config.manage'))
  with check (account_id = current_account_id() and whatsapp_active() and has_capability('config.manage'));
create policy notification_templates_delete on public.notification_templates for delete to authenticated
  using (account_id = current_account_id() and whatsapp_active() and has_capability('config.manage'));

drop policy if exists notification_batches_insert on public.notification_batches;
drop policy if exists notification_batches_update on public.notification_batches;
create policy notification_batches_insert on public.notification_batches for insert to authenticated
  with check (account_id = current_account_id() and whatsapp_active()
              and has_capability('notifications.send') and status = 'draft' and created_by = current_app_user_id());
create policy notification_batches_update on public.notification_batches for update to authenticated
  using (account_id = current_account_id() and whatsapp_active()
         and (has_capability('notifications.send') or has_capability('notifications.approve')))
  with check (account_id = current_account_id());

drop policy if exists notifications_insert on public.notifications_log;
drop policy if exists notifications_update on public.notifications_log;
drop policy if exists notifications_delete on public.notifications_log;
create policy notifications_insert on public.notifications_log for insert to authenticated
  with check (
    account_id = current_account_id() and whatsapp_active() and has_capability('notifications.send')
    and exists (select 1 from public.students s where s.id = student_id)
    and exists (select 1 from public.notification_batches b where b.id = batch_id and b.account_id = account_id and b.status = 'draft')
  );
create policy notifications_update on public.notifications_log for update to authenticated
  using (account_id = current_account_id() and whatsapp_active()
         and (has_capability('notifications.send') or has_capability('notifications.approve')))
  with check (account_id = current_account_id());
create policy notifications_delete on public.notifications_log for delete to authenticated
  using (account_id = current_account_id() and whatsapp_active()
         and (has_capability('notifications.send') or has_capability('notifications.approve'))
         and exists (select 1 from public.notification_batches b where b.id = batch_id and b.status = 'draft'));
