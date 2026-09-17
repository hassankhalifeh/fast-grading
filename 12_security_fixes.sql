-- =====================================================================
-- 12_security_fixes.sql
-- تصحيحات أمان اكتُشفت أثناء تنفيذ 07-11 على القاعدة الحقيقية عبر
-- Supabase Advisors - كلاهما موجود من قبل 07-11 وليس ناتج عنهما،
-- لكن أولهما كان سيمنع ملف 08 من العمل فعلياً وقت التشغيل:
--
-- 1) grade_history كانت RLS enabled عليها بدون أي policy إطلاقاً - يعني
--    أي INSERT من apply_grade_entry (08) كان سيُرفض تلقائياً لأي مستخدم
--    عادي (RLS enabled + no policy = رفض تام لغير service_role).
--
-- 2) الـ 6 views (v_grade_report وغيرها) كانت SECURITY DEFINER ضمنياً
--    (سلوك Postgres الافتراضي) - تشتغل بصلاحيات مالك الـ view متجاوزة
--    RLS، يعني أي مستخدم موثّق كان يقدر يشوف بيانات كل الحسابات عبر
--    هالـ views لا بيانات حسابه فقط. Supabase's linter صنّف هاي ERROR.
-- =====================================================================

CREATE POLICY grade_history_read ON grade_history
    FOR SELECT USING (grade_id IN (
        SELECT g.id FROM grades g JOIN exams e ON e.id = g.exam_id WHERE e.account_id = current_account_id()
    ));

CREATE POLICY grade_history_insert ON grade_history
    FOR INSERT WITH CHECK (grade_id IN (
        SELECT g.id FROM grades g JOIN exams e ON e.id = g.exam_id WHERE e.account_id = current_account_id()
    ));

ALTER VIEW v_exam_effective_score SET (security_invoker = true);
ALTER VIEW v_student_term_average SET (security_invoker = true);
ALTER VIEW v_student_class_rank SET (security_invoker = true);
ALTER VIEW v_class_term_summary SET (security_invoker = true);
ALTER VIEW v_school_term_summary SET (security_invoker = true);
ALTER VIEW v_grade_report SET (security_invoker = true);
-- =====================================================================
