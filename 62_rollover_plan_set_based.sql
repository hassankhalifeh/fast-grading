-- 62_rollover_plan_set_based.sql
-- إصلاح: create_rollover_plan تجاوزت مهلة الاستعلام (8 ثوانٍ لدور المستخدم المسجَّل) لأنها كانت تقرأ v_student_subject_year
-- مرة لكل طالب (الـview كاملاً ≈ 0.7 ثانية، فـ16 طالباً ≈ 10 ثوانٍ). صارت تقرأ الـviews مرة واحدة للحساب كله في جدولين مؤقتين،
-- وتحسب اقتراح كل الطلاب بتحديث واحد بدل حلقة.
--
-- ملاحظة أمان: الدالتان المنشأتان في 60 كان لهما EXECUTE لـPUBLIC افتراضياً (اكتُشف وسُحب في 61). كل دالة جديدة يجب أن تسحب
-- EXECUTE من public و anon صراحةً؛ سطر alter default privileges في 59 لا يفعل ذلك فعلياً (لا يزيل الافتراضي العام).
set search_path to fastgrading;

create or replace function create_rollover_plan(p_year_name text, p_options jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path to 'fastgrading', 'pg_temp' as $$
declare
  v_acc uuid := current_account_id(); v_me uuid := current_app_user_id();
  v_from uuid; v_plan uuid; v_thr numeric; v_opts jsonb;
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

  -- الـviews الثقيلة تُقرأ مرة واحدة للحساب كله
  drop table if exists ro_year;
  drop table if exists ro_promo;
  create temp table ro_year on commit drop as
    select y.student_id, y.class_section_id, count(*) filter (where y.subject_year_score < v_thr) as failed, count(*) as subjects
    from v_student_subject_year y where y.account_id = v_acc group by y.student_id, y.class_section_id;
  create temp table ro_promo on commit drop as
    select distinct on (pr.student_id, pr.class_section_id) pr.student_id, pr.class_section_id, pr.promoted
    from v_student_promotion pr join supplementary_sessions ss on ss.id = pr.session_id
    where ss.account_id = v_acc
    order by pr.student_id, pr.class_section_id, ss.created_at desc;

  -- النجاح: نتيجة الترفيع بعد التكميلي إن وُجدت، وإلا لا مادة راسبة بمعدل السنة؛ بلا علامات = معلّق
  update rollover_students rs set suggested_outcome = x.o, outcome = x.o, target_class_id = x.t
  from (
    select c.id,
      case when c.pass is null then 'pending' when c.pass then case when c.next_target is not null then 'promote' else 'graduate' end else 'repeat' end as o,
      case when c.pass is null then null when c.pass then c.next_target else c.own_target end as t
    from (
      select rs2.id,
        coalesce(p.promoted, case when y.subjects > 0 then y.failed = 0 end) as pass,
        (select rc.id from rollover_classes rc where rc.plan_id = v_plan and rc.source_class_id = rs2.source_class_id limit 1) as own_target,
        (select rc.id from rollover_classes rc join class_sections s on s.id = rc.source_class_id
          where rc.plan_id = v_plan and s.name = rollover_next_name(src.name) limit 1) as next_target
      from rollover_students rs2
      join class_sections src on src.id = rs2.source_class_id
      left join ro_promo p on p.student_id = rs2.student_id and p.class_section_id = rs2.source_class_id
      left join ro_year y on y.student_id = rs2.student_id and y.class_section_id = rs2.source_class_id
      where rs2.plan_id = v_plan
    ) c
  ) x
  where rs.id = x.id;

  return v_plan;
end $$;
revoke all on function create_rollover_plan(text, jsonb) from public, anon;
grant execute on function create_rollover_plan(text, jsonb) to authenticated, service_role;

reset search_path;
