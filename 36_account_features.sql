-- 36: الميزات الإضافية لكل حساب (Add-ons). تُفعَّل من مالك المنصة فقط (SQL/service role)، ولا يستطيع أي مستخدم تعديلها.
-- أول إضافة: whatsapp_notifications (إشعارات أولياء الأمور عبر واتساب). لا تمس البنية الأساسية: كل جدول/سياسة أساسي كما هو.

create table if not exists public.account_features (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  feature_key  text not null,
  enabled      boolean not null default true,
  activated_at timestamptz not null default now(),
  note         text,
  primary key (account_id, feature_key)
);

alter table public.account_features enable row level security;

-- القراءة لحسابك فقط (لتخفي الواجهة ما لم يُفعَّل). لا سياسات كتابة: التفعيل يتم بصلاحيات المالك فقط.
drop policy if exists account_features_read on public.account_features;
create policy account_features_read on public.account_features for select to authenticated
  using (account_id = current_account_id());
revoke insert, update, delete on public.account_features from anon, authenticated;
revoke all on public.account_features from anon;

-- مساعد للسياسات والدوال. SECURITY DEFINER (كبقية المساعدات) حتى لا تتعارض مع RLS.
create or replace function public.account_has_feature(p_key text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.account_features f
    where f.account_id = public.current_account_id() and f.feature_key = p_key and f.enabled
  );
$$;
revoke all on function public.account_has_feature(text) from public, anon;
grant execute on function public.account_has_feature(text) to authenticated;

-- إشعارات واتساب: تتطلب التفعيل + الصلاحية. بدون الإضافة تُرفض الكتابة على مستوى قاعدة البيانات.
drop policy if exists notifications_insert on public.notifications_log;
create policy notifications_insert on public.notifications_log for insert to authenticated
  with check (
    account_id = current_account_id()
    and account_has_feature('whatsapp_notifications')
    and has_capability('notifications.send')
    and exists (select 1 from public.students s where s.id = student_id)
  );

drop policy if exists notifications_update on public.notifications_log;
create policy notifications_update on public.notifications_log for update to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('notifications.send'))
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('notifications.send'));

drop policy if exists notification_templates_insert on public.notification_templates;
create policy notification_templates_insert on public.notification_templates for insert to authenticated
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('notifications.send'));

drop policy if exists notification_templates_update on public.notification_templates;
create policy notification_templates_update on public.notification_templates for update to authenticated
  using (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('notifications.send'))
  with check (account_id = current_account_id() and account_has_feature('whatsapp_notifications') and has_capability('notifications.send'));

-- الحذف يبقى بالصلاحية فقط (تنظيف)، والقراءة كما هي.
