-- 54_pending_work_summary.sql
-- «ما يحتاج انتباهك الآن» في الصفحة الرئيسية: ملخص أعداد الأعمال المعلّقة بنداء واحد.
--
-- SECURITY INVOKER عمداً: كل عدّ يمرّ عبر RLS، فيرى كل مستخدم أعداد ما يحق له رؤيته فقط (الأستاذ يرى امتحاناته، والناظر كل الحساب).
-- وكل عدّ مقيَّد صراحة بحساب المستخدم الحالي كي لا يرى مالك المنصة تجميعاً عبر كل المدارس.
--
-- يعدّ الطلاب المميَّزين بعلامة (count distinct) فلا يُضخَّم العدد في الامتحانات متعددة المكوّنات، ولا يتأثر بحدّ الـ1000 صف
-- الذي كان يقصّ عدّ العلامات في التقرير المبني على جلب كل الصفوف إلى المتصفح.
set search_path to fastgrading;

create or replace function my_pending_work() returns jsonb
language sql stable security invoker set search_path to 'fastgrading', 'pg_temp' as $$
  select jsonb_build_object(
    -- امتحانات حلّ موعدها وغير مقفلة وعدد من لهم علامة فيها أقل من المتوقَّع (طلاب الشعبة، أو مستحقّو التكميلي لهذه المادة والشعبة)
    'incomplete_exams', (
      select count(*) from exams e
      where e.account_id = current_account_id() and e.exam_date <= current_date and not e.is_locked_by_admin
        and (select count(distinct g.student_id) from grades g where g.exam_id = e.id)
          < case when e.supplementary_session_id is not null
              then (select count(*) from supplementary_eligibility s
                    where s.session_id = e.supplementary_session_id and s.class_section_id = e.class_section_id and s.subject_id = e.subject_id)
              else (select count(*) from class_enrollments ce where ce.class_section_id = e.class_section_id and ce.status = 'active')
            end
    ),
    -- نفس تعريف تقرير «تغطية التدريس»: كل صف نشط × كل مادة بلا أستاذ أساسي
    'uncovered_subjects', (
      select count(*) from class_sections cs
      join subjects s on s.account_id = cs.account_id
      where cs.account_id = current_account_id() and cs.is_active
        and not exists (select 1 from class_subject_teachers t
                        where t.class_section_id = cs.id and t.subject_id = s.id and t.assignment_role = 'primary')
    ),
    'pending_assignment_requests', (
      select count(*) from teaching_assignment_requests where account_id = current_account_id() and status = 'pending'
    ),
    'pending_imports', (
      select count(*) from import_batches where account_id = current_account_id() and status = 'pending_review'
    ),
    'draft_message_batches', (
      select count(*) from notification_batches where account_id = current_account_id() and status = 'draft'
    ),
    'open_violations', (
      select count(*) from message_violations where account_id = current_account_id() and review_status = 'open'
    )
  );
$$;

revoke all on function my_pending_work() from public, anon;
grant execute on function my_pending_work() to authenticated, service_role;

reset search_path;
