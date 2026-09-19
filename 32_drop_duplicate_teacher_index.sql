-- =====================================================================
-- 32_drop_duplicate_teacher_index.sql
-- فهرس أنشأه ملف 24 يطابق قيداً فريداً موجوداً أصلاً (class_section_id, subject_id, teacher_id)
-- =====================================================================
DROP INDEX IF EXISTS public.class_subject_teachers_teacher_once;
