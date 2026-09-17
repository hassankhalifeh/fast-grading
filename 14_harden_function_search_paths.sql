-- =====================================================================
-- 14_harden_function_search_paths.sql
-- يثبّت search_path=public على كل دوال المشروع (27 دالة) بدون تغيير
-- أي منطق - يمنع احتمال هجوم search_path hijacking. WARN-level بس
-- إصلاحه ميكانيكي وآمن 100% (ALTER FUNCTION لا يلمس جسم الدالة).
-- =====================================================================

ALTER FUNCTION public.enforce_solo_class_limit() SET search_path = public;
ALTER FUNCTION public.enforce_solo_student_limits() SET search_path = public;
ALTER FUNCTION public.enforce_grading_window() SET search_path = public;
ALTER FUNCTION public.block_audit_log_mutation() SET search_path = public;
ALTER FUNCTION public.current_app_user() SET search_path = public;
ALTER FUNCTION public.has_capability(text) SET search_path = public;
ALTER FUNCTION public.apply_default_capabilities(uuid, user_role_enum) SET search_path = public;
ALTER FUNCTION public.enforce_school_setup_before_grading() SET search_path = public;
ALTER FUNCTION public.enforce_component_weights_sum_100() SET search_path = public;
ALTER FUNCTION public.current_account_id() SET search_path = public;
ALTER FUNCTION public.current_app_user_id() SET search_path = public;
ALTER FUNCTION public.analyze_student_import_batch(uuid) SET search_path = public;
ALTER FUNCTION public.analyze_teacher_import_batch(uuid) SET search_path = public;
ALTER FUNCTION public.enforce_batch_fully_resolved(uuid, import_entity_enum) SET search_path = public;
ALTER FUNCTION public.commit_student_import_batch(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.check_existing_grade_components(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.apply_grade_entry(uuid, uuid, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.enforce_grades_admin_lock() SET search_path = public;
ALTER FUNCTION public.finalize_exam_submission(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.reopen_exam_submission(uuid, uuid, text) SET search_path = public;
ALTER FUNCTION public.reassign_grades_to_exam(uuid[], uuid, uuid, uuid) SET search_path = public;
ALTER FUNCTION public.get_actor_grade_authority_tier(uuid) SET search_path = public;
ALTER FUNCTION public.lower_exam_lock_tier(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.create_permission_resource(uuid, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.create_role_template(uuid, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.toggle_role_template_capability(uuid, text, boolean, uuid) SET search_path = public;
ALTER FUNCTION public.apply_role_template_to_user(uuid, uuid, uuid) SET search_path = public;
-- =====================================================================
