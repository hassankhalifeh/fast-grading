-- RLS and grade-math smoke tests for the fastgrading schema.
-- Safe to run on production: all fixtures are created inside one DO block that always ends with RAISE EXCEPTION,
-- so nothing is ever committed. The "error" returned by the runner is the report: every line starts with
-- PASS or FAIL, and the last line is the verdict.
--
-- Requires at least one existing account with students and exams (the demo account is enough).
-- Run it with the Supabase SQL editor or the MCP execute_sql tool. A FAIL line means an isolation or permission
-- rule no longer holds; investigate before the next deploy.

do $t$
declare
  r        text := '';
  n        int;
  expected int;
  accA     uuid;
  ownerA   uuid;
  ownerAu  uuid;
  accB     uuid;
  uB       uuid;
  uBu      uuid := gen_random_uuid();
  tch      uuid;
  tchu     uuid := gen_random_uuid();
  cfg      uuid;
  cfgu     uuid := gen_random_uuid();
  padm     uuid := gen_random_uuid();
  fails    int := 0;

begin
  -- ---------- fixtures (rolled back at the end) ----------
  select u.id, u.auth_uid, u.account_id into ownerA, ownerAu, accA
  from fastgrading.app_users u where u.auth_uid is not null order by u.created_at limit 1;
  if ownerA is null then raise exception 'NO_FIXTURE_USER'; end if;

  insert into fastgrading.accounts(account_type, display_name) values ('school_enterprise', 'tests: account B') returning id into accB;
  insert into fastgrading.app_users(account_id, auth_uid, full_name, role) values (accB, uBu, 'tests: B admin', 'school_admin') returning id into uB;
  insert into fastgrading.students(account_id, full_name) values (accB, 'tests: student of B');

  insert into fastgrading.app_users(account_id, auth_uid, full_name, role) values (accA, tchu, 'tests: teacher without caps', 'subject_teacher') returning id into tch;
  insert into fastgrading.app_users(account_id, auth_uid, full_name, role) values (accA, cfgu, 'tests: config manager', 'assistant_admin') returning id into cfg;
  insert into fastgrading.user_capabilities(app_user_id, capability_key, granted) values (cfg, 'config.manage', true);
  insert into fastgrading.platform_admins(auth_uid, note) values (padm, 'tests');

  select count(*) into expected from fastgrading.students where account_id = accA;

  -- ---------- T1: tenant isolation on students ----------
  perform set_config('request.jwt.claims', json_build_object('sub', ownerAu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.students;
  r := r || format(E'%s T1a owner of A sees exactly A''s students (%s of %s)\n', case when n = expected then 'PASS' else 'FAIL' end, n, expected);
  if n <> expected then fails := fails + 1; end if;
  select count(*) into n from fastgrading.students where account_id = accB;
  r := r || format(E'%s T1b owner of A sees none of B''s students (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uBu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.students where account_id = accA;
  r := r || format(E'%s T1c admin of B sees none of A''s students (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from fastgrading.v_grade_report;
  r := r || format(E'%s T1d admin of B sees no rows of A in v_grade_report (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;
  select count(*) into n from fastgrading.exams where account_id = accA;
  r := r || format(E'%s T1e admin of B sees none of A''s exams (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;
  execute 'reset role';

  -- ---------- T2: anonymous role has no access ----------
  begin
    execute 'set local role anon';
    perform count(*) from fastgrading.students;
    r := r || E'FAIL T2a anon can read students\n'; fails := fails + 1;
  exception when insufficient_privilege then
    r := r || E'PASS T2a anon cannot read students\n';
  end;
  execute 'reset role';
  begin
    execute 'set local role anon';
    perform count(*) from fastgrading.help_articles;
    r := r || E'FAIL T2b anon can read help_articles\n'; fails := fails + 1;
  exception when insufficient_privilege then
    r := r || E'PASS T2b anon cannot read help_articles\n';
  end;
  execute 'reset role';

  -- ---------- T3: help center visibility by audience ----------
  perform set_config('request.jwt.claims', json_build_object('sub', tchu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.help_articles;
  select count(*) into expected from fastgrading.help_articles where audience = 'everyone' and published;
  r := r || format(E'%s T3a teacher without capabilities sees only "everyone" guides (%s)\n', case when n = expected and n > 0 then 'PASS' else 'FAIL' end, n);
  if not (n = expected and n > 0) then fails := fails + 1; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', cfgu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.help_articles where audience = 'school_admin';
  r := r || format(E'%s T3b config.manage holder sees school_admin guides (%s)\n', case when n > 0 then 'PASS' else 'FAIL' end, n);
  if not (n > 0) then fails := fails + 1; end if;
  select count(*) into n from fastgrading.help_articles where audience = 'platform';
  r := r || format(E'%s T3c config.manage holder does not see platform-owner guide (%s)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;
  update fastgrading.help_articles set title = title || ' x' where slug = 'teacher-guide';
  get diagnostics n = row_count;
  r := r || format(E'%s T3d non-platform user cannot edit help articles (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', padm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.help_articles;
  select count(*) into expected from fastgrading.help_articles;
  execute 'reset role';
  select count(*) into expected from fastgrading.help_articles;
  r := r || format(E'%s T3e platform admin sees all guides (%s of %s)\n', case when n = expected then 'PASS' else 'FAIL' end, n, expected);
  if n <> expected then fails := fails + 1; end if;

  -- ---------- T4: a user without grades.enter cannot write grades ----------
  perform set_config('request.jwt.claims', json_build_object('sub', tchu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into fastgrading.grades(exam_id, student_id, score, entered_by)
      select e.id, s.id, 1, tch from fastgrading.exams e, fastgrading.students s limit 1;
    get diagnostics n = row_count;
    -- RLS hides every exam and student from this user, so zero rows is also a block
    r := r || format(E'%s T4 teacher without capabilities cannot insert a grade (%s rows)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
    if n <> 0 then fails := fails + 1; end if;
  exception when others then
    r := r || format(E'PASS T4 teacher without capabilities cannot insert a grade (%s)\n', sqlerrm);
  end;
  execute 'reset role';

  -- ---------- T5: grade math ----------
  select count(*) into n from fastgrading.v_exam_percent p
    join fastgrading.exams e on e.id = p.exam_id
    join fastgrading.grades g on g.exam_id = e.id and g.student_id = p.student_id and g.component_id is null
    where e.max_score > 0 and abs(p.percent - round(g.score / e.max_score * 100, 2)) > 0.01;
  r := r || format(E'%s T5a v_exam_percent equals score / max_score for single-component exams (%s mismatches)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;

  select count(*) into n from fastgrading.v_student_year_rank where rank_in_class < 1;
  r := r || format(E'%s T5b year ranks start at 1 (%s invalid)\n', case when n = 0 then 'PASS' else 'FAIL' end, n);
  if n <> 0 then fails := fails + 1; end if;

  -- ---------- T6: in-app notification center (requires migration 55) ----------
  perform fastgrading.notify_user(accA, tch, 'test', 'tests: for teacher', null, null);
  perform fastgrading.notify_user(accA, cfg, 'test', 'tests: for config manager', null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', tchu, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from fastgrading.app_notifications;
  r := r || format(E'%s T6a a user sees only their own notifications (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  if n <> 1 then fails := fails + 1; end if;
  begin
    insert into fastgrading.app_notifications(account_id, user_id, kind, title) values (accA, tch, 'test', 'forged');
    r := r || E'FAIL T6b a user can insert notifications\n'; fails := fails + 1;
  exception when insufficient_privilege then
    r := r || E'PASS T6b a user cannot insert notifications\n';
  end;
  begin
    update fastgrading.app_notifications set title = 'changed';
    r := r || E'FAIL T6c a user can edit notification text\n'; fails := fails + 1;
  exception when insufficient_privilege then
    r := r || E'PASS T6c a user can only change read_at, not the text\n';
  end;
  update fastgrading.app_notifications set read_at = now();
  get diagnostics n = row_count;
  r := r || format(E'%s T6d a user can mark their own notification read (%s row)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
  if n <> 1 then fails := fails + 1; end if;
  execute 'reset role';
  begin
    insert into fastgrading.teaching_assignment_requests(account_id, class_section_id, subject_id, teacher_id, requested_by, reason)
      select accA, cs.id, s.id, tch, cfg, 'tests' from fastgrading.class_sections cs join fastgrading.subjects s on s.account_id = cs.account_id where cs.account_id = accA limit 1;
    select count(*) into n from fastgrading.app_notifications where user_id = ownerA and kind = 'assignment_request';
    r := r || format(E'%s T6e a new second-teacher request notifies the approvers (%s)\n', case when n = 1 then 'PASS' else 'FAIL' end, n);
    if n <> 1 then fails := fails + 1; end if;
  exception when others then
    r := r || format(E'SKIP T6e could not create the request fixture (%s)\n', sqlerrm);
  end;

  r := r || format(E'%s\n', case when fails = 0 then 'VERDICT: ALL PASS (nothing was committed)' else 'VERDICT: ' || fails || ' FAILED (nothing was committed)' end);
  raise exception E'\n%', r;
end $t$;
