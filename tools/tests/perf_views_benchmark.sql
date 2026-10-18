-- Benchmark of the grade-calculation views on a synthetic mid-size school (rolled back, never commits).
--
-- Builds 1 account with 30 classes x 8 subjects, 1000 students and 48,000 confirmed grades (2 terms x 3 items, 1,440 exams),
-- runs ANALYZE (as autovacuum would on a real school) and times v_student_subject_year for one class and for the whole account.
-- The report is returned as an "error" (RAISE EXCEPTION); every line starts with PASS/FAIL/INFO.
--
-- Why ANALYZE matters: without table statistics the planner picks nested loops and the same view takes minutes (measured: 109 s)
-- instead of tens of milliseconds. A brand-new school that bulk-imports data can hit that window until autovacuum analyzes the tables.
-- Thresholds below are generous: one class must answer well inside the 8 s statement timeout of signed-in users.
--
-- Writing synthetic rows needs session_replication_role = replica (triggers off); it is local to this transaction.
-- Running it writes temporarily to the shared database, so run it only when approved.

do $t$
declare
  r text := ''; acc uuid; usr uuid; yr uuid; t1 uuid; t2 uuid; cls uuid; t0 timestamptz; n bigint; ms_one numeric; ms_all numeric; fails int := 0;
  n_cls int := 30; n_sub int := 8; n_stu int := 1000;
begin
  execute 'set local session_replication_role = replica';
  insert into fastgrading.accounts(account_type, display_name) values ('school_enterprise', 'perf-bench') returning id into acc;
  insert into fastgrading.app_users(account_id, full_name, role) values (acc, 'perf teacher', 'school_admin') returning id into usr;
  insert into fastgrading.academic_years(account_id, name, is_current) values (acc, 'bench', true) returning id into yr;
  insert into fastgrading.terms(account_id, name, academic_year_id, order_index) values (acc, 'T1', yr, 1) returning id into t1;
  insert into fastgrading.terms(account_id, name, academic_year_id, order_index) values (acc, 'T2', yr, 2) returning id into t2;
  insert into fastgrading.assessment_items(account_id, term_id, name, kind, order_index)
    select acc, t, 'item ' || i, 'coursework', i from (values (t1), (t2)) tt(t), generate_series(1, 3) i;
  insert into fastgrading.subjects(account_id, name) select acc, 'sub ' || i from generate_series(1, n_sub) i;
  insert into fastgrading.class_sections(account_id, name, created_by, academic_year_id) select acc, 'cls ' || i, usr, yr from generate_series(1, n_cls) i;
  insert into fastgrading.students(account_id, full_name) select acc, 'stu ' || i from generate_series(1, n_stu) i;
  insert into fastgrading.class_enrollments(class_section_id, student_id, status)
    select c.id, s.id, 'active'
    from (select id, row_number() over (order by name) rn from fastgrading.class_sections where account_id = acc) c
    join (select id, row_number() over (order by full_name) rn from fastgrading.students where account_id = acc) s on ((s.rn - 1) % n_cls) + 1 = c.rn;
  insert into fastgrading.exams(account_id, class_section_id, subject_id, exam_name, exam_date, term_id, item_id)
    select acc, c.id, sb.id, 'ex', current_date, i.term_id, i.id
    from fastgrading.class_sections c cross join fastgrading.subjects sb cross join fastgrading.assessment_items i
    where c.account_id = acc and sb.account_id = acc and i.account_id = acc;
  insert into fastgrading.grades(exam_id, student_id, score, status, entered_by)
    select e.id, ce.student_id, 40 + (hashtext(e.id::text || ce.student_id::text) % 60 + 60) % 60, 'confirmed', usr
    from fastgrading.exams e join fastgrading.class_enrollments ce on ce.class_section_id = e.class_section_id where e.account_id = acc;
  analyze fastgrading.grades; analyze fastgrading.exams; analyze fastgrading.class_enrollments; analyze fastgrading.assessment_items;
  analyze fastgrading.terms; analyze fastgrading.class_sections; analyze fastgrading.grading_overrides; analyze fastgrading.exam_type_components;
  select id into cls from fastgrading.class_sections where account_id = acc order by name limit 1;

  execute 'set local statement_timeout = ''90s''';
  begin
    t0 := clock_timestamp(); select count(*) into n from fastgrading.v_student_subject_year where class_section_id = cls;
    ms_one := extract(epoch from clock_timestamp() - t0) * 1000;
    r := r || format(E'%s B1 year view for ONE class (%s rows): %s ms (limit 1000)\n', case when ms_one < 1000 then 'PASS' else 'FAIL' end, n, round(ms_one));
    if ms_one >= 1000 then fails := fails + 1; end if;
    t0 := clock_timestamp(); select count(*) into n from fastgrading.v_student_subject_year where account_id = acc;
    ms_all := extract(epoch from clock_timestamp() - t0) * 1000;
    r := r || format(E'%s B2 year view for the WHOLE account (%s rows): %s ms (limit 8000)\n', case when ms_all < 8000 then 'PASS' else 'FAIL' end, n, round(ms_all));
    if ms_all >= 8000 then fails := fails + 1; end if;
  exception when query_canceled then
    r := r || E'FAIL B1/B2 view exceeded 90 s\n'; fails := fails + 1;
  end;

  r := r || format(E'%s\n', case when fails = 0 then 'VERDICT: ALL PASS (nothing was committed)' else 'VERDICT: ' || fails || ' FAILED (nothing was committed)' end);
  raise exception E'\n%', r;
end $t$;
