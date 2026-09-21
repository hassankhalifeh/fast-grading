-- 42: ضبط محتوى الرسائل: حجب الألفاظ الخادشة للحياء (جنسية/سباب/إهانة/تهديد) وتوثيق كل مخالفة للمراجعة والمحاسبة.
-- الحجب لا يعتمد على رفض العملية (لأن الرفض يمسح سجل المخالفة)، بل تُحفظ الرسالة بحالة "محجوبة" وتُسجَّل المخالفة، ثم يُمنع اعتمادها وإرسالها.

-- ===== القاموس =====
create table if not exists public.moderation_terms (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,   -- null = قاموس المنصة العام
  term       text not null,
  term_norm  text not null,
  category   text not null check (category in ('sexual', 'profanity', 'insult', 'threat', 'other')),
  kind       text not null default 'block' check (kind in ('block', 'allow')),   -- allow = استثناء (مثلاً اسم علم يطابق لفظاً محجوباً)
  active     boolean not null default true,
  added_by   uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists moderation_terms_uq on public.moderation_terms (coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), term_norm, kind);
alter table public.moderation_terms enable row level security;
revoke all on public.moderation_terms from anon, authenticated;
grant select, insert, update, delete on public.moderation_terms to authenticated;

-- المدرسة ترى وتعدّل مصطلحاتها هي فقط؛ القاموس العام مخفي عنها ولا تعدّله
drop policy if exists moderation_terms_read on public.moderation_terms;
create policy moderation_terms_read on public.moderation_terms for select to authenticated
  using (account_id = current_account_id() and has_capability('config.manage'));
drop policy if exists moderation_terms_write on public.moderation_terms;
create policy moderation_terms_write on public.moderation_terms for insert to authenticated
  with check (account_id = current_account_id() and has_capability('config.manage'));
drop policy if exists moderation_terms_update on public.moderation_terms;
create policy moderation_terms_update on public.moderation_terms for update to authenticated
  using (account_id = current_account_id() and has_capability('config.manage'))
  with check (account_id = current_account_id() and has_capability('config.manage'));
drop policy if exists moderation_terms_delete on public.moderation_terms;
create policy moderation_terms_delete on public.moderation_terms for delete to authenticated
  using (account_id = current_account_id() and has_capability('config.manage'));

-- توحيد النص: تشكيل/تطويل/أحرف صفرية، الهمزات، ى→ي، ة→ه، تقليص تكرار الحرف (3+ إلى 1)، مسافات
create or replace function public.mod_normalize(t text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(regexp_replace(lower(coalesce(t, '')), '[ً-ٰٟـ​-‏]', '', 'g'), 'أإآٱىةؤئ', 'اااايهوي'),
      '(.)\1{2,}', '\1', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function public.tg_moderation_terms_norm() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.term := btrim(new.term);
  new.term_norm := public.mod_normalize(new.term);
  if length(new.term_norm) < 2 and new.term_norm ~ '[ء-يa-z0-9]' then raise exception 'المصطلح قصير جداً'; end if;
  return new;
end $$;
drop trigger if exists moderation_terms_norm on public.moderation_terms;
create trigger moderation_terms_norm before insert or update of term on public.moderation_terms
  for each row execute function public.tg_moderation_terms_norm();
revoke all on function public.tg_moderation_terms_norm() from public, anon, authenticated;

-- الفحص: كلمة كاملة (مع سوابق و/ف/ب/ل/ك و"ال" ولواحق الضمائر الشائعة). الاستثناءات (allow) تُزال من النص قبل الفحص.
create or replace function public.mod_scan(p_account uuid, p_text text)
returns table (term text, category text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t text := public.mod_normalize(p_text); r record; a record;
begin
  if t = '' then return; end if;
  for a in select x.term_norm from public.moderation_terms x where x.kind = 'allow' and x.active and (x.account_id is null or x.account_id = p_account) loop
    t := replace(t, a.term_norm, ' ');
  end loop;
  for r in select x.term, x.term_norm, x.category from public.moderation_terms x where x.kind = 'block' and x.active and (x.account_id is null or x.account_id = p_account) loop
    if t ~ ('(^|[^ء-يa-z0-9])[وفبلك]?(ال)?' || regexp_replace(r.term_norm, '([.^$*+?(){}\[\]|\\])', '\\\1', 'g') || '(ك|ه|ها|هم|هن|ي|نا|ات|ين|ون)?($|[^ء-يa-z0-9])')
       or (r.term_norm !~ '[ء-يa-z0-9]' and position(r.term_norm in t) > 0) then   -- الرموز التعبيرية
      term := r.term; category := r.category; return next;
    end if;
  end loop;
end $$;
revoke all on function public.mod_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.mod_scan(uuid, text) to service_role;

-- فحص فوري للواجهة أثناء الكتابة (لا يسجّل شيئاً)
create or replace function public.moderation_check(p_text text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('term', s.term, 'category', s.category)), '[]'::jsonb)
  from public.mod_scan(public.current_account_id(), p_text) s;
$$;
revoke all on function public.moderation_check(text) from public, anon;
grant execute on function public.moderation_check(text) to authenticated;

-- ===== سجل المخالفات (دائم) =====
create table if not exists public.message_violations (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete restrict,
  occurred_at      timestamptz not null default now(),
  user_id          uuid,
  user_name        text,
  context          text not null check (context in ('template', 'draft_message', 'edited_message')),
  message_type     text,
  template_id      uuid,
  notification_id  uuid,
  batch_id         uuid,
  student_name     text,
  matched_terms    text[] not null,
  categories       text[] not null,
  excerpt          text,
  review_status    text not null default 'open' check (review_status in ('open', 'confirmed', 'dismissed')),
  reviewed_by      uuid,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_note      text
);
create index if not exists message_violations_acc_idx on public.message_violations (account_id, occurred_at desc);
create index if not exists message_violations_user_idx on public.message_violations (account_id, user_id);
alter table public.message_violations enable row level security;
revoke all on public.message_violations from anon, authenticated;
grant select on public.message_violations to authenticated;
drop policy if exists message_violations_read on public.message_violations;
create policy message_violations_read on public.message_violations for select to authenticated
  using (account_id = current_account_id() and (has_capability('config.manage') or has_capability('notifications.approve')));

-- لا تعديل على محتوى المخالفة (إلا حقول المراجعة)، ولا حذف إلا بتطهير صريح من المالك
create or replace function public.tg_violations_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.allow_purge', true), '') = '1' then return old; end if;
    raise exception 'سجل المخالفات دائم ولا يمكن حذفه';
  end if;
  if new.account_id is distinct from old.account_id or new.occurred_at is distinct from old.occurred_at or new.user_id is distinct from old.user_id
     or new.user_name is distinct from old.user_name or new.context is distinct from old.context or new.matched_terms is distinct from old.matched_terms
     or new.categories is distinct from old.categories or new.excerpt is distinct from old.excerpt or new.notification_id is distinct from old.notification_id
     or new.template_id is distinct from old.template_id or new.batch_id is distinct from old.batch_id then
    raise exception 'سجل المخالفات لا يُعدَّل';
  end if;
  return new;
end $$;
drop trigger if exists message_violations_guard on public.message_violations;
create trigger message_violations_guard before update or delete on public.message_violations
  for each row execute function public.tg_violations_guard();
revoke all on function public.tg_violations_guard() from public, anon, authenticated;

create or replace function public.review_violation(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (has_capability('config.manage') or has_capability('notifications.approve')) then raise exception 'ليس لديك صلاحية مراجعة المخالفات'; end if;
  if p_status not in ('open', 'confirmed', 'dismissed') then raise exception 'حالة غير صالحة'; end if;
  update public.message_violations set
    review_status = p_status, reviewed_by = current_app_user_id(), reviewed_by_name = (select full_name from public.app_users where id = current_app_user_id()),
    reviewed_at = now(), review_note = left(p_note, 500)
  where id = p_id and account_id = current_account_id();
end $$;
revoke all on function public.review_violation(uuid, text, text) from public, anon;
grant execute on function public.review_violation(uuid, text, text) to authenticated;

-- ===== الرسائل: فحص كل نص وحجبه =====
alter table public.notifications_log
  add column if not exists moderation_status text not null default 'clean';
alter table public.notifications_log drop constraint if exists notifications_log_moderation_chk;
alter table public.notifications_log add constraint notifications_log_moderation_chk check (moderation_status in ('clean', 'blocked'));

create or replace function public.tg_notifications_moderation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_terms text[]; v_cats text[]; v_uname text; v_sname text;
begin
  if tg_op = 'UPDATE' and new.rendered_message is not distinct from old.rendered_message then
    new.moderation_status := old.moderation_status;      -- الحالة لا تُضبط من العميل
  else
    select array_agg(distinct s.term), array_agg(distinct s.category) into v_terms, v_cats from public.mod_scan(new.account_id, new.rendered_message) s;
    if v_terms is null then
      new.moderation_status := 'clean';
    else
      new.moderation_status := 'blocked';
      select full_name into v_uname from public.app_users where id = current_app_user_id();
      select full_name into v_sname from public.students where id = new.student_id;
      insert into public.message_violations (account_id, user_id, user_name, context, message_type, notification_id, batch_id, student_name, matched_terms, categories, excerpt)
      values (new.account_id, current_app_user_id(), v_uname, case when tg_op = 'INSERT' then 'draft_message' else 'edited_message' end,
              new.message_type, new.id, new.batch_id, v_sname, v_terms, v_cats, left(new.rendered_message, 1000));
    end if;
  end if;
  if new.status = 'sent' and new.moderation_status = 'blocked' then
    raise exception 'محتوى غير لائق: لا يمكن إرسال هذه الرسالة';
  end if;
  return new;
end $$;
drop trigger if exists notifications_log_moderation on public.notifications_log;
create trigger notifications_log_moderation before insert or update on public.notifications_log
  for each row execute function public.tg_notifications_moderation();
revoke all on function public.tg_notifications_moderation() from public, anon, authenticated;

-- ===== القوالب =====
alter table public.notification_templates
  add column if not exists moderation_status text not null default 'clean';
alter table public.notification_templates drop constraint if exists notification_templates_moderation_chk;
alter table public.notification_templates add constraint notification_templates_moderation_chk check (moderation_status in ('clean', 'blocked'));

create or replace function public.tg_templates_moderation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_terms text[]; v_cats text[]; v_uname text;
begin
  if tg_op = 'UPDATE' and new.body_template is not distinct from old.body_template then
    new.moderation_status := old.moderation_status;
    return new;
  end if;
  select array_agg(distinct s.term), array_agg(distinct s.category) into v_terms, v_cats from public.mod_scan(new.account_id, new.body_template) s;
  if v_terms is null then
    new.moderation_status := 'clean';
  else
    new.moderation_status := 'blocked';
    select full_name into v_uname from public.app_users where id = current_app_user_id();
    insert into public.message_violations (account_id, user_id, user_name, context, message_type, template_id, matched_terms, categories, excerpt)
    values (new.account_id, current_app_user_id(), v_uname, 'template', new.message_type, new.id, v_terms, v_cats, left(new.body_template, 1000));
  end if;
  return new;
end $$;
drop trigger if exists notification_templates_moderation on public.notification_templates;
create trigger notification_templates_moderation before insert or update on public.notification_templates
  for each row execute function public.tg_templates_moderation();
revoke all on function public.tg_templates_moderation() from public, anon, authenticated;

-- ===== منع اعتماد دفعة فيها رسائل محجوبة =====
create or replace function public.tg_guard_notification_batch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.account_id is distinct from old.account_id or new.created_by is distinct from old.created_by
     or new.message_type is distinct from old.message_type or new.exam_id is distinct from old.exam_id then
    raise exception 'لا يمكن تغيير بيانات الدفعة الأساسية';
  end if;
  if auth.uid() is null then return new; end if;

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
      if exists (select 1 from public.notifications_log l where l.batch_id = old.id and l.included and l.moderation_status = 'blocked') then
        raise exception 'الدفعة تحوي رسائل محجوبة لاحتوائها ألفاظاً غير لائقة: عدّل نصها أو استبعدها قبل الاعتماد';
      end if;
      new.approved_by := current_app_user_id();
      new.approved_at := now();
    end if;
  end if;
  return new;
end $$;

-- ===== القاموس العام الابتدائي (يُراجع ويُوسَّع من مالك المنصة) =====
insert into public.moderation_terms (account_id, term, category) values
  (null,'شرموطة','sexual'),(null,'شرموط','sexual'),(null,'عاهرة','sexual'),(null,'قحبة','sexual'),(null,'متناك','sexual'),(null,'منيوك','sexual'),
  (null,'نيك','sexual'),(null,'ينيك','sexual'),(null,'كس','sexual'),(null,'كسمك','sexual'),(null,'طيز','sexual'),(null,'زب','sexual'),(null,'بزاز','sexual'),
  (null,'سكس','sexual'),(null,'اباحي','sexual'),(null,'عرص','sexual'),(null,'معرص','sexual'),(null,'لواط','sexual'),(null,'ايري','sexual'),
  (null,'خرا','profanity'),(null,'ابن الحرام','profanity'),(null,'ابن الكلب','profanity'),(null,'ابن الشرموطة','profanity'),(null,'ابن القحبة','profanity'),(null,'يلعن','profanity'),
  (null,'غبي','insult'),(null,'غبية','insult'),(null,'حمار','insult'),(null,'كلب','insult'),(null,'حيوان','insult'),(null,'تافه','insult'),(null,'حقير','insult'),
  (null,'وسخ','insult'),(null,'قذر','insult'),(null,'معوق','insult'),(null,'متخلف','insult'),(null,'احمق','insult'),(null,'اهبل','insult'),(null,'فاشل','insult'),(null,'بليد','insult'),
  (null,'اقتلك','threat'),(null,'ساقتلك','threat'),(null,'اذبحك','threat'),(null,'ساذبحك','threat'),
  (null,'fuck','profanity'),(null,'shit','profanity'),(null,'bitch','profanity'),(null,'whore','sexual'),(null,'porn','sexual'),(null,'sex','sexual'),(null,'dick','sexual'),(null,'pussy','sexual'),(null,'asshole','profanity'),
  (null,'🍆','sexual'),(null,'🍑','sexual'),(null,'🔞','sexual'),(null,'🖕','insult')
on conflict do nothing;
