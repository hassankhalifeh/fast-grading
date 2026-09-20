-- 35: تتبع الإرسال التلقائي عبر واتساب (Cloud API): قالب، معاملات، رقم رسالة المزوّد، حالة التسليم

alter table public.notifications_log
  add column if not exists wa_template_name text,
  add column if not exists wa_language text,
  add column if not exists wa_params jsonb,
  add column if not exists provider_message_id text,
  add column if not exists error_text text,
  add column if not exists claimed_at timestamptz,
  add column if not exists delivery_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

create index if not exists notifications_log_provider_msg_idx on public.notifications_log (provider_message_id) where provider_message_id is not null;
