-- 55_notification_center.sql
-- مركز إشعارات داخل التطبيق (جرس): صندوق وارد لكل مستخدم، تكتبه التريغرات فقط ويقرؤه صاحبه فقط.
--
-- الأحداث الأولى: طلب إسناد أستاذ ثانٍ (للمعتمدين)، البتّ بالطلب (لمقدّمه)، إسناد مادة لأستاذ،
-- مسودة مراسلات جديدة (للمعتمدين)، اعتماد/رفض مسودة (لمنشئها)، مخالفة محتوى جديدة (لمن يراجعها).
--
-- قاعدة ذهبية: فشل إنشاء إشعار لا يُفشل العملية الأصلية أبداً (كل التريغرات تبتلع أخطاءها).
set search_path to fastgrading;

create table if not exists app_notifications (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  user_id     uuid not null references app_users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  section     text,                       -- القسم الذي يفتحه النقر (مثل teachers / moderation)
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists app_notifications_user_idx on app_notifications (user_id, created_at desc);
create index if not exists app_notifications_unread_idx on app_notifications (user_id) where read_at is null;

alter table app_notifications enable row level security;

drop policy if exists app_notifications_select_own on app_notifications;
create policy app_notifications_select_own on app_notifications for select
  using (user_id = current_app_user_id());
drop policy if exists app_notifications_update_own on app_notifications;
create policy app_notifications_update_own on app_notifications for update
  using (user_id = current_app_user_id()) with check (user_id = current_app_user_id());
drop policy if exists app_notifications_delete_own on app_notifications;
create policy app_notifications_delete_own on app_notifications for delete
  using (user_id = current_app_user_id());

-- لا إدراج من العميل إطلاقاً (التريغرات SECURITY DEFINER وحدها تكتب)، والمستخدم يعدّل read_at فقط
revoke all on app_notifications from anon, authenticated;
grant select, delete on app_notifications to authenticated;
grant update (read_at) on app_notifications to authenticated;
grant all on app_notifications to service_role;

-- ---------- مساعدات (لا تُستدعى من العميل) ----------

-- مستخدمو الحساب النشطون الذين يملكون صلاحية معيّنة
create or replace function users_with_capability(p_account uuid, p_capability text) returns setof uuid
language sql stable security definer set search_path to 'fastgrading', 'pg_temp' as $$
  select u.id from app_users u
  join user_capabilities uc on uc.app_user_id = u.id and uc.capability_key = p_capability and uc.granted
  where u.account_id = p_account and u.is_active;
$$;

create or replace function notify_user(p_account uuid, p_user uuid, p_kind text, p_title text, p_body text, p_section text) returns void
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
begin
  if p_user is null then return; end if;
  insert into app_notifications (account_id, user_id, kind, title, body, section)
  values (p_account, p_user, p_kind, p_title, p_body, p_section);
exception when others then
  null;  -- لا نكسر العملية الأصلية بسبب إشعار
end $$;

revoke all on function users_with_capability(uuid, text) from public, anon, authenticated;
revoke all on function notify_user(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function users_with_capability(uuid, text), notify_user(uuid, uuid, text, text, text, text) to service_role;

-- ---------- التريغرات ----------

-- 1) طلب أستاذ ثانٍ جديد → كل من يملك teaching.approve_secondary
create or replace function tg_notify_assignment_request() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare v_cls text; v_sub text; v_tch text; v_u uuid;
begin
  begin
    select name into v_cls from class_sections where id = new.class_section_id;
    select name into v_sub from subjects where id = new.subject_id;
    select full_name into v_tch from app_users where id = new.teacher_id;
    for v_u in select * from users_with_capability(new.account_id, 'teaching.approve_secondary') loop
      if v_u is distinct from new.requested_by then
        perform notify_user(new.account_id, v_u, 'assignment_request', 'طلب إسناد أستاذ ثانٍ بانتظار موافقتك',
          format('%s · %s — الأستاذ المقترح: %s', coalesce(v_cls, '—'), coalesce(v_sub, '—'), coalesce(v_tch, '—')), 'teachers');
      end if;
    end loop;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_assignment_request on teaching_assignment_requests;
create trigger trg_notify_assignment_request after insert on teaching_assignment_requests
  for each row when (new.status = 'pending') execute function tg_notify_assignment_request();

-- 2) البتّ بالطلب → مقدّمه (ولا نكرّر إن كان هو الأستاذ المُسنَد إليه، فسيصله إشعار الإسناد)
create or replace function tg_notify_assignment_decided() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare v_cls text; v_sub text;
begin
  begin
    if new.status in ('approved', 'rejected') and old.status = 'pending' and new.requested_by is not null
       and not (new.status = 'approved' and new.requested_by = new.teacher_id) then
      select name into v_cls from class_sections where id = new.class_section_id;
      select name into v_sub from subjects where id = new.subject_id;
      perform notify_user(new.account_id, new.requested_by, 'assignment_decided',
        case when new.status = 'approved' then 'وُوفق على طلب الأستاذ الثاني' else 'رُفض طلب الأستاذ الثاني' end,
        format('%s · %s%s', coalesce(v_cls, '—'), coalesce(v_sub, '—'), case when new.decision_note is not null and new.decision_note <> '' then ' — ' || new.decision_note else '' end),
        'teachers');
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_assignment_decided on teaching_assignment_requests;
create trigger trg_notify_assignment_decided after update of status on teaching_assignment_requests
  for each row execute function tg_notify_assignment_decided();

-- 3) إسناد مادة لأستاذ → الأستاذ نفسه (إلا إن أسند نفسه)
create or replace function tg_notify_teacher_assigned() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare v_acc uuid; v_cls text; v_sub text;
begin
  begin
    if new.teacher_id is distinct from current_app_user_id() then
      select account_id, name into v_acc, v_cls from class_sections where id = new.class_section_id;
      select name into v_sub from subjects where id = new.subject_id;
      perform notify_user(v_acc, new.teacher_id, 'teacher_assigned',
        case when new.assignment_role = 'secondary' then 'أُسندت إليك مادة كأستاذ ثانٍ' else 'أُسندت إليك مادة جديدة' end,
        format('%s · %s', coalesce(v_cls, '—'), coalesce(v_sub, '—')), 'gradeEntry');
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_teacher_assigned on class_subject_teachers;
create trigger trg_notify_teacher_assigned after insert on class_subject_teachers
  for each row execute function tg_notify_teacher_assigned();

-- 4) مسودة مراسلات جديدة → من يملك notifications.approve (عدا منشئها)
create or replace function tg_notify_batch_draft() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare v_u uuid;
begin
  begin
    for v_u in select * from users_with_capability(new.account_id, 'notifications.approve') loop
      if v_u is distinct from new.created_by then
        perform notify_user(new.account_id, v_u, 'batch_draft', 'مسودة مراسلات بانتظار اعتمادك', coalesce(new.title, new.message_type), 'notifications');
      end if;
    end loop;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_batch_draft on notification_batches;
create trigger trg_notify_batch_draft after insert on notification_batches
  for each row when (new.status = 'draft') execute function tg_notify_batch_draft();

-- 5) اعتماد/رفض مسودة → منشئها
create or replace function tg_notify_batch_decided() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
begin
  begin
    if new.status in ('approved', 'rejected') and old.status = 'draft' and new.created_by is not null
       and new.created_by is distinct from current_app_user_id() then
      perform notify_user(new.account_id, new.created_by, 'batch_decided',
        case when new.status = 'approved' then 'اعتُمدت مسودة المراسلات' else 'رُفضت مسودة المراسلات' end,
        coalesce(new.title, new.message_type) || case when new.review_note is not null and new.review_note <> '' then ' — ' || new.review_note else '' end,
        'notifications');
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_batch_decided on notification_batches;
create trigger trg_notify_batch_decided after update of status on notification_batches
  for each row execute function tg_notify_batch_decided();

-- 6) مخالفة محتوى جديدة → من يراجعها (notifications.send)، عدا كاتبها
create or replace function tg_notify_violation() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare v_u uuid;
begin
  begin
    for v_u in select * from users_with_capability(new.account_id, 'notifications.send') loop
      if v_u is distinct from new.user_id then
        perform notify_user(new.account_id, v_u, 'violation', 'مخالفة محتوى بانتظار المراجعة', coalesce(new.user_name, ''), 'moderation');
      end if;
    end loop;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_notify_violation on message_violations;
create trigger trg_notify_violation after insert on message_violations
  for each row execute function tg_notify_violation();

reset search_path;
