-- 48: fix a severe performance bug in the supplementary/promotion report views.
--
-- v_student_supplementary_result and v_student_promotion LEFT-JOIN against the
-- deep aggregate view stack (v_student_subject_year -> ... -> grades, which is
-- RLS-protected). Under RLS, the planner chose a Nested Loop Left Join that
-- re-evaluates the entire expensive aggregate subtree once per outer row
-- instead of once total. The planner's cost estimate for this plan looked
-- cheap (it does not know the true cost of the STABLE helper functions used
-- inside the aggregate chain), so it never picked a better plan on its own.
-- Confirmed with a real account: querying these views by session_id timed out
-- (>20s) for just 17 rows under RLS as an authenticated user, while the exact
-- same computation via `select count(*)` (no materialization needed) or as
-- superuser (RLS bypassed) returned instantly. Forcing the shared aggregate
-- inputs to compute once via `WITH ... AS MATERIALIZED` fixes this: verified
-- fast and byte-for-byte identical results before applying here.
--
-- This changes query shape only — no RLS policy, grant, or column changed,
-- so it cannot affect who can see what, only how fast the same rows return.

create or replace view v_student_supplementary_result as
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

create or replace view v_student_promotion as
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
