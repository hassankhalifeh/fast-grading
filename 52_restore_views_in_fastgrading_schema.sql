-- 52: restore every SQL view in the `fastgrading` schema (BusPulse shared project).
--
-- The 2026-10-02 move to the shared database copied tables, functions, policies, triggers and data but NOT views,
-- so the whole averages/reports chain was missing (found by the 2026-10-10 audit). This recreates all 13 views with the
-- same definitions the legacy database had (reconstructed from the repo migrations 21/31/48 and a legacy snapshot of
-- v_exam_effective_score, v_student_term_average, v_student_class_rank, v_class_term_summary, v_school_term_summary,
-- v_grade_report), in dependency order.
--
-- Every view is security_invoker = true: reads run with the CALLER's RLS (account isolation + grades scoping). Do NOT
-- recreate a view without the WITH clause (CREATE OR REPLACE VIEW resets reloptions and would silently bypass RLS).
-- The supplementary pair keeps migration 48's MATERIALIZED shape (planner picked a per-row nested loop under RLS).
-- Access: SELECT for authenticated and service_role only (anon none).

set search_path to fastgrading;

create or replace view v_exam_effective_score with (security_invoker = true) as
 select g.exam_id,
    g.student_id,
        case
            when (count(g.component_id) filter (where (g.component_id is not null)) = 0) then max(g.score)
            else (sum((g.score * etc.weight_percent)) / nullif(sum(etc.weight_percent), (0)::numeric))
        end as effective_score,
    bool_and((g.status = 'confirmed'::grade_status_enum)) as all_confirmed
   from (grades g
     left join exam_type_components etc on ((etc.id = g.component_id)))
  group by g.exam_id, g.student_id;

create or replace view v_exam_percent with (security_invoker = true) as
select e.account_id, ees.exam_id, ees.student_id, e.class_section_id, e.subject_id,
       e.item_id, e.term_id,
       ees.effective_score / nullif(e.max_score, 0) * 100 as percent,
       ees.all_confirmed
from v_exam_effective_score ees
join exams e on e.id = ees.exam_id;

create or replace view v_student_subject_item with (security_invoker = true) as
select p.account_id, p.student_id, p.class_section_id, p.subject_id, p.item_id, p.term_id,
       sum(p.percent * w.w) / nullif(sum(w.w), 0) as item_score,
       count(*) as exams_count
from v_exam_percent p
cross join lateral (select effective_exam_weight(p.exam_id, p.class_section_id, p.subject_id) as w) w
where p.all_confirmed and p.item_id is not null
group by p.account_id, p.student_id, p.class_section_id, p.subject_id, p.item_id, p.term_id;

create or replace view v_student_subject_term with (security_invoker = true) as
select s.account_id, s.student_id, s.class_section_id, s.subject_id, s.term_id,
       sum(s.item_score * iw.w) / nullif(sum(iw.w), 0) as subject_term_score,
       count(*) filter (where iw.w > 0) as items_present,
       (select count(*) from assessment_items x
         where x.term_id = s.term_id
           and effective_item_weight(x.id, s.class_section_id, s.subject_id) > 0) as items_total
from v_student_subject_item s
cross join lateral (select effective_item_weight(s.item_id, s.class_section_id, s.subject_id) as w) iw
group by s.account_id, s.student_id, s.class_section_id, s.subject_id, s.term_id;

create or replace view v_student_term_average with (security_invoker = true) as
select student_id, term_id, class_section_id, avg(subject_term_score) as term_average
from v_student_subject_term
group by student_id, term_id, class_section_id;

create or replace view v_student_subject_year with (security_invoker = true) as
select s.account_id, s.student_id, s.class_section_id, s.subject_id,
       sum(s.subject_term_score * tw.w) / nullif(sum(tw.w), 0) as subject_year_score,
       count(*) filter (where tw.w > 0) as terms_present
from v_student_subject_term s
cross join lateral (select effective_term_weight(s.term_id, s.class_section_id, s.subject_id) as w) tw
group by s.account_id, s.student_id, s.class_section_id, s.subject_id;

create or replace view v_student_year_rank with (security_invoker = true) as
select student_id, class_section_id, year_average,
       rank() over (partition by class_section_id order by year_average desc) as rank_in_class,
       count(*) over (partition by class_section_id) as class_size
from (
    select student_id, class_section_id, avg(subject_year_score) as year_average
    from v_student_subject_year
    group by student_id, class_section_id
) t;

create or replace view v_student_class_rank with (security_invoker = true) as
 select student_id,
    term_id,
    class_section_id,
    term_average,
    rank() over (partition by class_section_id, term_id order by term_average desc) as rank_in_class,
    count(*) over (partition by class_section_id, term_id) as class_size
   from v_student_term_average;

create or replace view v_class_term_summary with (security_invoker = true) as
 select cs.id as class_section_id,
    cs.stage_id,
    sta.term_id,
    avg(sta.term_average) as class_average,
    rank() over (partition by cs.stage_id, sta.term_id order by (avg(sta.term_average)) desc) as rank_in_stage
   from (class_sections cs
     join v_student_term_average sta on ((sta.class_section_id = cs.id)))
  group by cs.id, cs.stage_id, sta.term_id;

create or replace view v_school_term_summary with (security_invoker = true) as
 select cs.account_id,
    sta.term_id,
    avg(sta.term_average) as school_average,
    count(distinct sta.student_id) as student_count
   from (class_sections cs
     join v_student_term_average sta on ((sta.class_section_id = cs.id)))
  group by cs.account_id, sta.term_id;

create or replace view v_grade_report with (security_invoker = true) as
 select a.display_name as account_name,
    cs.name as class_name,
    sub.name as subject_name,
    ex.exam_name,
    ex.exam_date,
    st.full_name as student_name,
    st.parent_email,
    st.parent_phone,
    g.score,
    ex.max_score,
    round(((g.score / nullif(ex.max_score, (0)::numeric)) * (100)::numeric), 1) as percentage,
        case
            when (g.score >= (ex.max_score * 0.5)) then 'Pass'::text
            else 'Fail'::text
        end as passing_status,
    g.status as grade_status,
    g.entry_method,
    teacher.full_name as entered_by_name,
    g.updated_at as last_updated_at,
    latest_note.channel as last_notification_channel,
    latest_note.status as last_notification_status,
    latest_note.sent_at as last_notification_sent_at
   from (((((((grades g
     join exams ex on ((ex.id = g.exam_id)))
     join accounts a on ((a.id = ex.account_id)))
     join class_sections cs on ((cs.id = ex.class_section_id)))
     join subjects sub on ((sub.id = ex.subject_id)))
     join students st on ((st.id = g.student_id)))
     join app_users teacher on ((teacher.id = g.entered_by)))
     left join lateral ( select nl.channel,
            nl.status,
            nl.sent_at
           from notifications_log nl
          where ((nl.student_id = g.student_id) and (nl.exam_id = ex.id))
          order by nl.created_at desc
         limit 1) latest_note on (true));

create or replace view v_student_supplementary_result with (security_invoker = true) as
with thr as (
  select ses_1.id as session_id, coalesce(gp.passing_threshold_percent, 50::numeric) as pass
  from supplementary_sessions ses_1
  left join grading_policies gp on gp.account_id = ses_1.account_id
),
y_all as materialized (
  select * from v_student_subject_year
),
supp as materialized (
  select e.supplementary_session_id as session_id, p.student_id, e.subject_id, p.percent as supp_score
  from v_exam_percent p
  join exams e on e.id = p.exam_id
  where e.supplementary_session_id is not null and p.all_confirmed
)
select
  el.session_id,
  el.student_id,
  el.class_section_id,
  el.subject_id,
  y.subject_year_score as year_score,
  s.supp_score,
  ses.mode,
  thr.pass as pass_threshold,
  case
    when s.supp_score is null then y.subject_year_score
    when ses.mode = 'replace'::supplementary_mode_enum then s.supp_score
    when ses.mode = 'higher_of'::supplementary_mode_enum then greatest(y.subject_year_score, s.supp_score)
    else case
      when s.supp_score >= thr.pass then greatest(y.subject_year_score, thr.pass)
      else greatest(y.subject_year_score, s.supp_score)
    end
  end as final_score,
  y.subject_year_score >= thr.pass as passed_before
from supplementary_eligibility el
join supplementary_sessions ses on ses.id = el.session_id
join thr on thr.session_id = el.session_id
left join y_all y on y.student_id = el.student_id and y.subject_id = el.subject_id and y.class_section_id = el.class_section_id
left join supp s on s.session_id = el.session_id and s.student_id = el.student_id and s.subject_id = el.subject_id;

create or replace view v_student_promotion with (security_invoker = true) as
with thr as (
  select ses_1.id as session_id, coalesce(gp.passing_threshold_percent, 50::numeric) as pass
  from supplementary_sessions ses_1
  left join grading_policies gp on gp.account_id = ses_1.account_id
),
y_all as materialized (
  select * from v_student_subject_year
),
r_all as materialized (
  select * from v_student_supplementary_result
)
select
  ses.id as session_id,
  y.student_id,
  y.class_section_id,
  count(*) filter (where y.subject_year_score < thr.pass) as failed_before,
  count(*) filter (where coalesce(r.final_score, y.subject_year_score) < thr.pass) as failed_after,
  ses.max_failed_subjects,
  count(*) filter (where coalesce(r.final_score, y.subject_year_score) < thr.pass) <= ses.max_failed_subjects as promoted
from supplementary_sessions ses
join thr on thr.session_id = ses.id
join y_all y on y.account_id = ses.account_id
left join r_all r on r.session_id = ses.id and r.student_id = y.student_id and r.subject_id = y.subject_id and r.class_section_id = y.class_section_id
group by ses.id, y.student_id, y.class_section_id, ses.max_failed_subjects;

grant select on
  v_exam_effective_score, v_exam_percent, v_student_subject_item, v_student_subject_term, v_student_term_average,
  v_student_subject_year, v_student_year_rank, v_student_class_rank, v_class_term_summary, v_school_term_summary,
  v_grade_report, v_student_supplementary_result, v_student_promotion
to authenticated, service_role;

reset search_path;
