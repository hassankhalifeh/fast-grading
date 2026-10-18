-- 60_year_rollover.sql
-- ترحيل السنة الدراسية: يحضّر النظام اقتراح نقل الطلاب إلى صفوف السنة الجديدة بحسب نجاحهم، ثم تراجعه الإدارة (أو من تسمح له
-- بصلاحية roster.manage) وتؤكد انتساب كل طالب (قد يكون بعضهم غادر المدرسة)، ثم يُعتمد الترحيل دفعة واحدة.
--
-- نموذج البيانات: كل سنة لها شعبها الخاصة. لا حاجة لتعديل الـviews: كلها تجمّع أصلاً حسب (طالب، شعبة، مادة، فصل)، فتبقى علامات
-- السنة القديمة معزولة في شعبها القديمة، وتبدأ السنة الجديدة بشعب وفصول وامتحانات جديدة. الشعب القديمة تُؤرشف (is_active=false)
-- ويُضاف إلى اسمها اسم السنة القديمة فتبقى واضحة في التقارير التاريخية. تسجيلات الطلاب القديمة تصير 'completed' فلا تُحتسب في الحدود.
--
-- صلاحيات: البدء والاعتماد النهائي والإلغاء = config.manage؛ تعديل الشعب الهدف وقرارات الطلاب وتأكيدها = roster.manage أو config.manage.
set search_path to fastgrading;

-- ---------- ربط الشعب بالسنة الدراسية ----------
alter table class_sections add column if not exists academic_year_id uuid references academic_years(id) on delete set null;
create index if not exists class_sections_year_idx on class_sections (academic_year_id);

update class_sections cs set academic_year_id = (select y.id from academic_years y where y.account_id = cs.account_id and y.is_current limit 1)
where cs.academic_year_id is null;

-- أي شعبة جديدة تُوسَم تلقائياً بالسنة الحالية (فلا حاجة لتعديل شاشات إنشاء الصفوف والاستيراد)
create or replace function tg_class_section_default_year() returns trigger
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
begin
  if new.academic_year_id is null then
    select y.id into new.academic_year_id from academic_years y where y.account_id = new.account_id and y.is_current limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_class_section_default_year on class_sections;
create trigger trg_class_section_default_year before insert on class_sections for each row execute function tg_class_section_default_year();

-- ---------- جداول خطة الترحيل ----------
create table if not exists rollover_plans (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  from_year_id  uuid not null references academic_years(id),
  to_year_name  text not null check (length(trim(to_year_name)) between 3 and 60),
  to_year_id    uuid references academic_years(id),
  options       jsonb not null default '{"structure": true, "overrides": true, "teachers": true}',
  status        text not null default 'draft' check (status in ('draft', 'applied')),
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  summary       jsonb
);
create unique index if not exists rollover_plans_one_draft on rollover_plans (account_id) where status = 'draft';

create table if not exists rollover_classes (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(id) on delete cascade,
  plan_id          uuid not null references rollover_plans(id) on delete cascade,
  source_class_id  uuid references class_sections(id) on delete set null,   -- null = شعبة جديدة كلياً
  name             text not null check (length(trim(name)) > 0),
  grade_level      text,
  stage_id         uuid references stages(id) on delete set null,
  floor_id         uuid references floors(id) on delete set null,
  section_label    text,
  sort_order       integer not null default 0
);
create index if not exists rollover_classes_plan_idx on rollover_classes (plan_id);

create table if not exists rollover_students (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  plan_id            uuid not null references rollover_plans(id) on delete cascade,
  student_id         uuid not null references students(id) on delete cascade,
  source_class_id    uuid not null references class_sections(id) on delete cascade,
  target_class_id    uuid references rollover_classes(id) on delete set null,
  suggested_outcome  text not null default 'pending' check (suggested_outcome in ('promote', 'repeat', 'graduate', 'left', 'pending')),
  outcome            text not null default 'pending' check (outcome in ('promote', 'repeat', 'graduate', 'left', 'pending')),
  confirmed          boolean not null default false,
  note               text check (note is null or length(note) <= 300),
  unique (plan_id, student_id)
);
create index if not exists rollover_students_plan_idx on rollover_students (plan_id, source_class_id);

-- قرار الطالب يجب أن يشير إلى شعبة هدف من نفس الخطة؛ وأي قرار «معلّق» لا يُعدّ مؤكَّداً
create or replace function tg_rollover_student_check() returns trigger
language plpgsql set search_path to 'fastgrading', 'pg_temp' as $$
begin
  if new.target_class_id is not null and not exists (select 1 from rollover_classes c where c.id = new.target_class_id and c.plan_id = new.plan_id) then
    raise exception 'الشعبة الهدف ليست من هذه الخطة';
  end if;
  if new.outcome = 'pending' then new.confirmed := false; end if;
  if new.outcome in ('graduate', 'left') then new.target_class_id := null; end if;
  return new;
end $$;
drop trigger if exists trg_rollover_student_check on rollover_students;
create trigger trg_rollover_student_check before update on rollover_students for each row execute function tg_rollover_student_check();

-- ---------- RLS ----------
alter table rollover_plans enable row level security;
alter table rollover_classes enable row level security;
alter table rollover_students enable row level security;

drop policy if exists rollover_plans_read on rollover_plans;
create policy rollover_plans_read on rollover_plans for select using (account_id = current_account_id() and (has_capability('roster.manage') or has_capability('config.manage')));
drop policy if exists rollover_plans_delete on rollover_plans;
create policy rollover_plans_delete on rollover_plans for delete using (account_id = current_account_id() and status = 'draft' and has_capability('config.manage'));

drop policy if exists rollover_classes_all on rollover_classes;
create policy rollover_classes_all on rollover_classes for all
  using (account_id = current_account_id() and (has_capability('roster.manage') or has_capability('config.manage'))
         and exists (select 1 from rollover_plans p where p.id = plan_id and p.status = 'draft'))
  with check (account_id = current_account_id() and (has_capability('roster.manage') or has_capability('config.manage'))
         and exists (select 1 from rollover_plans p where p.id = plan_id and p.status = 'draft' and p.account_id = current_account_id()));

drop policy if exists rollover_students_read on rollover_students;
create policy rollover_students_read on rollover_students for select using (account_id = current_account_id() and (has_capability('roster.manage') or has_capability('config.manage')));
drop policy if exists rollover_students_update on rollover_students;
create policy rollover_students_update on rollover_students for update
  using (account_id = current_account_id() and (has_capability('roster.manage') or has_capability('config.manage'))
         and exists (select 1 from rollover_plans p where p.id = plan_id and p.status = 'draft'))
  with check (account_id = current_account_id());

revoke all on rollover_plans, rollover_classes, rollover_students from anon, authenticated;
grant select, delete on rollover_plans to authenticated;
grant select, insert, delete on rollover_classes to authenticated;
grant update (name, grade_level, stage_id, floor_id, section_label, sort_order) on rollover_classes to authenticated;
grant select on rollover_students to authenticated;
grant update (outcome, target_class_id, confirmed, note) on rollover_students to authenticated;
grant all on rollover_plans, rollover_classes, rollover_students to service_role;

-- ---------- اسم الصف التالي: يزيد أول رقم في الاسم ("الصف 2" → "الصف 3"، "الصف 2 أ" → "الصف 3 أ") ----------
create or replace function rollover_next_name(p_name text) returns text
language plpgsql immutable set search_path to 'fastgrading', 'pg_temp' as $$
declare m text[];
begin
  m := regexp_match(p_name, '^(.*?)(\d+)(\D*)$');
  if m is null then return null; end if;
  return m[1] || (m[2]::int + 1)::text || m[3];
end $$;
revoke all on function rollover_next_name(text) from public, anon;
grant execute on function rollover_next_name(text) to authenticated, service_role;

-- ---------- تحضير الخطة واقتراح مصير كل طالب ----------
-- النجاح: إن وُجدت نتيجة ترفيع (بعد التكميلي) تُعتمد، وإلا يُعدّ ناجحاً من لا مادة راسبة عنده بمعدل السنة (حد النجاح من سياسة العلامات).
-- بلا علامات إطلاقاً → «معلّق» ليقرّره المراجع. الناجح → شعبة الصف التالي إن وُجدت بين الهدف وإلا «تخرّج/غادر»؛ الراسب → شعبته المجدّدة.
create or replace function create_rollover_plan(p_year_name text, p_options jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare
  v_acc uuid := current_account_id(); v_me uuid := current_app_user_id();
  v_from uuid; v_plan uuid; v_thr numeric; v_opts jsonb;
  r record; v_failed int; v_subjects int; v_pass boolean; v_next_target uuid; v_own_target uuid; v_src_name text;
begin
  if not has_capability('config.manage') then raise exception 'بدء ترحيل السنة من صلاحية إدارة الإعدادات'; end if;
  if length(trim(coalesce(p_year_name, ''))) < 3 then raise exception 'اسم السنة الجديدة مطلوب'; end if;
  if exists (select 1 from rollover_plans where account_id = v_acc and status = 'draft') then raise exception 'يوجد ترحيل قيد التحضير، أكمله أو ألغِه أولاً'; end if;
  if exists (select 1 from academic_years where account_id = v_acc and lower(name) = lower(trim(p_year_name))) then raise exception 'توجد سنة دراسية بهذا الاسم'; end if;
  select id into v_from from academic_years where account_id = v_acc and is_current;
  if v_from is null then raise exception 'لا توجد سنة دراسية حالية'; end if;

  v_opts := jsonb_build_object('structure', coalesce((p_options ->> 'structure')::boolean, true),
                               'overrides', coalesce((p_options ->> 'overrides')::boolean, true),
                               'teachers',  coalesce((p_options ->> 'teachers')::boolean, true));
  insert into rollover_plans (account_id, from_year_id, to_year_name, options, created_by)
  values (v_acc, v_from, trim(p_year_name), v_opts, v_me) returning id into v_plan;

  insert into rollover_classes (account_id, plan_id, source_class_id, name, grade_level, stage_id, floor_id, section_label, sort_order)
  select v_acc, v_plan, cs.id, cs.name, cs.grade_level, cs.stage_id, cs.floor_id, cs.section_label, row_number() over (order by cs.name)
  from class_sections cs where cs.account_id = v_acc and cs.is_active;

  insert into rollover_students (account_id, plan_id, student_id, source_class_id)
  select distinct on (ce.student_id) v_acc, v_plan, ce.student_id, ce.class_section_id
  from class_enrollments ce join class_sections cs on cs.id = ce.class_section_id
  where cs.account_id = v_acc and cs.is_active and ce.status = 'active'
  order by ce.student_id, ce.enrolled_at desc;

  select coalesce((select passing_threshold_percent from grading_policies where account_id = v_acc), 50) into v_thr;

  for r in select rs.id, rs.student_id, rs.source_class_id from rollover_students rs where rs.plan_id = v_plan loop
    select count(*) filter (where y.subject_year_score < v_thr), count(*) into v_failed, v_subjects
    from v_student_subject_year y where y.student_id = r.student_id and y.class_section_id = r.source_class_id;

    v_pass := null;
    select pr.promoted into v_pass from v_student_promotion pr
      join supplementary_sessions ss on ss.id = pr.session_id
      where pr.student_id = r.student_id and pr.class_section_id = r.source_class_id
      order by ss.created_at desc limit 1;
    if v_pass is null and v_subjects > 0 then v_pass := (v_failed = 0); end if;

    select id into v_own_target from rollover_classes where plan_id = v_plan and source_class_id = r.source_class_id limit 1;
    select name into v_src_name from class_sections where id = r.source_class_id;
    select c.id into v_next_target from rollover_classes c join class_sections s on s.id = c.source_class_id
      where c.plan_id = v_plan and s.name = rollover_next_name(v_src_name) limit 1;

    if v_pass is null then
      update rollover_students set suggested_outcome = 'pending', outcome = 'pending' where id = r.id;
    elsif v_pass then
      if v_next_target is not null then
        update rollover_students set suggested_outcome = 'promote', outcome = 'promote', target_class_id = v_next_target where id = r.id;
      else
        update rollover_students set suggested_outcome = 'graduate', outcome = 'graduate' where id = r.id;
      end if;
    else
      update rollover_students set suggested_outcome = 'repeat', outcome = 'repeat', target_class_id = v_own_target where id = r.id;
    end if;
  end loop;

  return v_plan;
end $$;
revoke all on function create_rollover_plan(text, jsonb) from public, anon;
grant execute on function create_rollover_plan(text, jsonb) to authenticated, service_role;

-- ---------- اعتماد الترحيل ----------
create or replace function apply_rollover_plan(p_plan uuid) returns jsonb
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare
  v_acc uuid := current_account_id(); v_me uuid := current_app_user_id();
  pl rollover_plans; v_old_name text; v_new uuid;
  rc record; rs record; t record; it record; ov record;
  term_map jsonb := '{}'; item_map jsonb := '{}'; class_map jsonb := '{}'; src_map jsonb := '{}';
  v_new_class uuid; n_classes int := 0; n_enrolled int := 0; n_terms int := 0; n_items int := 0; n_teachers int := 0; n_overrides int := 0;
  n_promote int; n_repeat int; n_graduate int; n_left int;
begin
  if not has_capability('config.manage') then raise exception 'اعتماد ترحيل السنة من صلاحية إدارة الإعدادات'; end if;
  select * into pl from rollover_plans where id = p_plan and account_id = v_acc for update;
  if not found then raise exception 'خطة الترحيل غير موجودة'; end if;
  if pl.status <> 'draft' then raise exception 'تم اعتماد هذه الخطة سابقاً'; end if;
  if exists (select 1 from rollover_students where plan_id = p_plan and outcome = 'pending') then raise exception 'يوجد طلاب بلا قرار، احسم مصير كل طالب أولاً'; end if;
  if exists (select 1 from rollover_students where plan_id = p_plan and not confirmed) then raise exception 'يوجد طلاب لم يُؤكَّد انتسابهم بعد'; end if;
  if exists (select 1 from rollover_students where plan_id = p_plan and outcome in ('promote', 'repeat') and target_class_id is null) then raise exception 'يوجد طلاب بلا شعبة هدف'; end if;

  select name into v_old_name from academic_years where id = pl.from_year_id;

  update academic_years set is_current = false where id = pl.from_year_id;
  insert into academic_years (account_id, name, is_current) values (v_acc, pl.to_year_name, true) returning id into v_new;

  -- هيكل الفصول وبنود التقييم
  if coalesce((pl.options ->> 'structure')::boolean, true) then
    for t in select * from terms where account_id = v_acc and academic_year_id = pl.from_year_id order by order_index loop
      declare v_term uuid; begin
        insert into terms (account_id, name, start_date, end_date, academic_year_id, order_index, default_weight)
        values (v_acc, t.name, t.start_date + case when t.start_date is null then null else interval '1 year' end,
                t.end_date + case when t.end_date is null then null else interval '1 year' end, v_new, t.order_index, t.default_weight)
        returning id into v_term;
        term_map := term_map || jsonb_build_object(t.id::text, v_term); n_terms := n_terms + 1;
      end;
    end loop;
    for it in select i.* from assessment_items i where i.account_id = v_acc and i.term_id in (select id from terms where academic_year_id = pl.from_year_id) order by i.order_index loop
      declare v_item uuid; begin
        insert into assessment_items (account_id, term_id, name, kind, order_index, default_weight, default_template_id)
        values (v_acc, (term_map ->> it.term_id::text)::uuid, it.name, it.kind, it.order_index, it.default_weight, it.default_template_id)
        returning id into v_item;
        item_map := item_map || jsonb_build_object(it.id::text, v_item); n_items := n_items + 1;
      end;
    end loop;
  end if;

  -- إغلاق تسجيلات الطلاب الحالية، ثم أرشفة الشعب القديمة (قبل إنشاء الجديدة كي لا يُتجاوز حد عدد الصفوف)
  update class_enrollments ce set status = 'completed'
  from rollover_students s where s.plan_id = p_plan and ce.student_id = s.student_id and ce.class_section_id = s.source_class_id and ce.status = 'active';
  update class_sections cs set is_active = false, name = cs.name || ' — ' || v_old_name
  where cs.id in (select source_class_id from rollover_classes where plan_id = p_plan and source_class_id is not null) and cs.is_active;

  -- الشعب الجديدة
  for rc in select * from rollover_classes where plan_id = p_plan order by sort_order, name loop
    insert into class_sections (account_id, name, grade_level, stage_id, floor_id, section_label, is_active, created_by, academic_year_id, school_id)
    values (v_acc, rc.name, rc.grade_level, rc.stage_id, rc.floor_id, rc.section_label, true, v_me, v_new,
            (select school_id from class_sections where id = rc.source_class_id))
    returning id into v_new_class;
    class_map := class_map || jsonb_build_object(rc.id::text, v_new_class); n_classes := n_classes + 1;
    if rc.source_class_id is not null and not (src_map ? rc.source_class_id::text) then
      src_map := src_map || jsonb_build_object(rc.source_class_id::text, v_new_class);
    end if;
  end loop;

  -- تسجيل الطلاب في شعبهم الجديدة
  for rs in select * from rollover_students where plan_id = p_plan and outcome in ('promote', 'repeat') loop
    insert into class_enrollments (class_section_id, student_id, status)
    values ((class_map ->> rs.target_class_id::text)::uuid, rs.student_id, 'active') on conflict do nothing;
    n_enrolled := n_enrolled + 1;
  end loop;

  -- إسناد الأساتذة الأساسيين للشعب المجدّدة (الأستاذ الثاني يحتاج موافقة جديدة)
  if coalesce((pl.options ->> 'teachers')::boolean, true) then
    for rc in select * from rollover_classes where plan_id = p_plan and source_class_id is not null loop
      insert into class_subject_teachers (class_section_id, subject_id, teacher_id, assignment_role)
      select (class_map ->> rc.id::text)::uuid, t2.subject_id, t2.teacher_id, 'primary'
      from class_subject_teachers t2 where t2.class_section_id = rc.source_class_id and t2.assignment_role = 'primary'
      on conflict do nothing;
    end loop;
    select count(*) into n_teachers from class_subject_teachers where class_section_id in (select value::uuid from jsonb_each_text(class_map)) and assignment_role = 'primary';
  end if;

  -- تجاوزات الأوزان الخاصة بالفصول وبنود التقييم (تجاوزات الامتحانات الفردية لا تُنسخ)
  if coalesce((pl.options ->> 'overrides')::boolean, true) and coalesce((pl.options ->> 'structure')::boolean, true) then
    for ov in select * from grading_overrides where account_id = v_acc and target in ('term_weight', 'item_weight') loop
      declare v_t uuid := null; v_i uuid := null; v_c uuid := null; begin
        if ov.target = 'term_weight' then v_t := (term_map ->> ov.term_id::text)::uuid; if v_t is null then continue; end if; end if;
        if ov.target = 'item_weight' then v_i := (item_map ->> ov.item_id::text)::uuid; if v_i is null then continue; end if; end if;
        if ov.class_section_id is not null then
          v_c := (src_map ->> ov.class_section_id::text)::uuid; if v_c is null then continue; end if;
        end if;
        insert into grading_overrides (account_id, scope, stage_id, class_section_id, subject_id, target, term_id, item_id, value, note, created_by)
        values (v_acc, ov.scope, ov.stage_id, v_c, ov.subject_id, ov.target, v_t, v_i, ov.value, ov.note, v_me) on conflict do nothing;
        n_overrides := n_overrides + 1;
      end;
    end loop;
  end if;

  select count(*) filter (where outcome = 'promote'), count(*) filter (where outcome = 'repeat'),
         count(*) filter (where outcome = 'graduate'), count(*) filter (where outcome = 'left')
    into n_promote, n_repeat, n_graduate, n_left from rollover_students where plan_id = p_plan;

  update rollover_plans set status = 'applied', to_year_id = v_new, applied_at = now(),
    summary = jsonb_build_object('classes', n_classes, 'terms', n_terms, 'items', n_items, 'overrides', n_overrides, 'teachers', n_teachers,
                                 'promote', n_promote, 'repeat', n_repeat, 'graduate', n_graduate, 'left', n_left)
  where id = p_plan;

  insert into audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
  values (v_acc, v_me, 'update', 'academic_years', v_new,
          jsonb_build_object('rollover_from', v_old_name, 'rollover_to', pl.to_year_name, 'promote', n_promote, 'repeat', n_repeat, 'graduate', n_graduate, 'left', n_left));

  return (select summary from rollover_plans where id = p_plan) || jsonb_build_object('year', pl.to_year_name);
end $$;
revoke all on function apply_rollover_plan(uuid) from public, anon;
grant execute on function apply_rollover_plan(uuid) to authenticated, service_role;

reset search_path;
