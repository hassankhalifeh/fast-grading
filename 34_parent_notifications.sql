-- 34: إشعارات أولياء الأمور (واتساب): سجل الدفعات + سياسات مبنية على صلاحية notifications.send

alter table public.notifications_log
  add column if not exists to_phone text,
  add column if not exists batch_id uuid,
  add column if not exists sent_by uuid;

create index if not exists notifications_log_batch_idx on public.notifications_log (account_id, batch_id);
create index if not exists notifications_log_exam_idx on public.notifications_log (exam_id, student_id);

drop policy if exists notifications_write on public.notifications_log;
drop policy if exists notifications_insert on public.notifications_log;
drop policy if exists notifications_update on public.notifications_log;

create policy notifications_insert on public.notifications_log for insert to authenticated
  with check (
    account_id = current_account_id()
    and has_capability('notifications.send')
    and exists (select 1 from public.students s where s.id = student_id)
  );

-- تغيير الحالة فقط (pending -> sent/failed) من نفس الحساب
create policy notifications_update on public.notifications_log for update to authenticated
  using (account_id = current_account_id() and has_capability('notifications.send'))
  with check (account_id = current_account_id() and has_capability('notifications.send'));

-- القوالب: نفس الصلاحية بدل قائمة الأدوار الثابتة
drop policy if exists notification_templates_insert on public.notification_templates;
drop policy if exists notification_templates_update on public.notification_templates;
drop policy if exists notification_templates_delete on public.notification_templates;

create policy notification_templates_insert on public.notification_templates for insert to authenticated
  with check (account_id = current_account_id() and has_capability('notifications.send'));
create policy notification_templates_update on public.notification_templates for update to authenticated
  using (account_id = current_account_id() and has_capability('notifications.send'))
  with check (account_id = current_account_id() and has_capability('notifications.send'));
create policy notification_templates_delete on public.notification_templates for delete to authenticated
  using (account_id = current_account_id() and has_capability('notifications.send'));
