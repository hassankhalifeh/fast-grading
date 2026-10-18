-- 61_revoke_public_on_rollover_trigger_functions.sql
-- الدالتان المنشأتان في 60 (تريغرات) بقي لهما EXECUTE لـPUBLIC افتراضياً فظهرتا ضمن ما يستطيع anon تنفيذه (اكتُشف بالفحص بعد التطبيق).
-- قاعدة: كل دالة جديدة في fastgrading يجب أن تسحب EXECUTE من public و anon صراحةً (alter default privileges ... in schema لا يزيل الافتراضي العام).
set search_path to fastgrading;
revoke execute on function tg_class_section_default_year() from public, anon;
revoke execute on function tg_rollover_student_check() from public, anon;
reset search_path;
