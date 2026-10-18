-- 65_ai_class_record.sql
-- مصدر «سجل» لمساعد الذكاء الاصطناعي: قراءة صف بمعرّفه (أرقام مجمَّعة بلا أسماء طلاب). مطلوب لاختبار data_retrieval في Devology
-- (سجل مرئي وسجل مخفي): ترجع null لصف لا يراه المستخدم، فيعامله الموصّل كـ NOT_FOUND.
set search_path to fastgrading;

create or replace function ai_class_record(p_id uuid) returns jsonb
language plpgsql stable set search_path to 'fastgrading', 'pg_temp' as $$
begin
  perform ai_guard();
  return (
    select jsonb_build_object(
      'class', cs.name,
      'students', (select count(*) from class_enrollments ce where ce.class_section_id = cs.id and ce.status = 'active'),
      'term_averages', coalesce((select jsonb_agg(jsonb_build_object('term', t.name, 'class_average', round(v.class_average::numeric, 1)) order by t.order_index)
                                 from v_class_term_summary v join terms t on t.id = v.term_id where v.class_section_id = cs.id), '[]'::jsonb))
    from class_sections cs where cs.id = p_id and cs.account_id = current_account_id()
  );
end $$;
revoke execute on function ai_class_record(uuid) from public, anon;
grant execute on function ai_class_record(uuid) to authenticated, service_role;

reset search_path;
