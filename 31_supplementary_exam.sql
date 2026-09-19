-- =====================================================================
-- 31_supplementary_exam.sql
-- الامتحان التكميلي: دور تكميلي (session) تحدد فيه الإدارة المواد المرتبطة والطلاب
-- المستحقين (تُقترح القاعدة الضعفاء تحت حد النجاح)، ويُعقد امتحان تكميلي لكل
-- (شعبة، مادة) لا يكتب فيه إلا المستحقون. أثره على العلامة النهائية والترفيع حسب
-- سياسة الدور: استبدال / الأعلى / سقف عند حد النجاح.
-- لا يدخل بمعدلات الفصول/السنة (بلا بند تقييم)، فتبقى معدلات السنة الأصلية سليمة.
-- =====================================================================

INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'supplementary.manage', 'إدارة الامتحان التكميلي (تحديد المواد والطلاب المستحقين)', 'Admin', id, 'modify'
FROM permission_resources WHERE code = 'grades'
ON CONFLICT (key) DO NOTHING;

CREATE TYPE supplementary_mode_enum AS ENUM ('replace', 'higher_of', 'capped_at_pass');

CREATE TABLE supplementary_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts(id),
    academic_year_id    UUID REFERENCES academic_years(id),
    name                TEXT NOT NULL,
    mode                supplementary_mode_enum NOT NULL DEFAULT 'capped_at_pass',
    max_failed_subjects INTEGER NOT NULL DEFAULT 0 CHECK (max_failed_subjects >= 0),
    created_by          UUID REFERENCES app_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX supplementary_sessions_account_idx ON supplementary_sessions (account_id);
CREATE INDEX supplementary_sessions_year_idx ON supplementary_sessions (academic_year_id);

CREATE TABLE supplementary_subjects (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES supplementary_sessions(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    UNIQUE (session_id, subject_id)
);
CREATE INDEX supplementary_subjects_subject_idx ON supplementary_subjects (subject_id);

CREATE TABLE supplementary_eligibility (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID NOT NULL REFERENCES supplementary_sessions(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id       UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
    reason           TEXT,
    added_by         UUID REFERENCES app_users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, student_id, subject_id)
);
CREATE INDEX supplementary_eligibility_student_idx ON supplementary_eligibility (student_id);
CREATE INDEX supplementary_eligibility_subject_idx ON supplementary_eligibility (subject_id);
CREATE INDEX supplementary_eligibility_class_idx ON supplementary_eligibility (class_section_id);

ALTER TABLE exams ADD COLUMN supplementary_session_id UUID REFERENCES supplementary_sessions(id) ON DELETE SET NULL;
CREATE INDEX exams_supplementary_idx ON exams (supplementary_session_id);
ALTER TABLE exams ADD CONSTRAINT exams_supplementary_no_item_ck CHECK (supplementary_session_id IS NULL OR item_id IS NULL);

-- سلامة الاستحقاق: المادة ضمن مواد الدور، والطالب مسجّل بالشعبة، ونفس الحساب
CREATE OR REPLACE FUNCTION validate_supplementary_eligibility()
RETURNS TRIGGER AS $$
DECLARE v_acc UUID;
BEGIN
    SELECT account_id INTO v_acc FROM supplementary_sessions WHERE id = NEW.session_id;
    IF NOT EXISTS (SELECT 1 FROM supplementary_subjects WHERE session_id = NEW.session_id AND subject_id = NEW.subject_id) THEN
        RAISE EXCEPTION 'هذه المادة ليست ضمن مواد الدور التكميلي';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM class_enrollments WHERE student_id = NEW.student_id AND class_section_id = NEW.class_section_id) THEN
        RAISE EXCEPTION 'الطالب غير مسجّل بهذه الشعبة';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND account_id = v_acc)
       OR NOT EXISTS (SELECT 1 FROM class_sections WHERE id = NEW.class_section_id AND account_id = v_acc) THEN
        RAISE EXCEPTION 'الطالب والشعبة يجب أن يتبعوا نفس حساب الدور';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_supplementary_eligibility
    BEFORE INSERT ON supplementary_eligibility
    FOR EACH ROW EXECUTE FUNCTION validate_supplementary_eligibility();

-- في الامتحان التكميلي: لا يكتب علامة إلا الطالب المستحق لتلك المادة
CREATE OR REPLACE FUNCTION enforce_supplementary_eligibility_on_grades()
RETURNS TRIGGER AS $$
DECLARE v_session UUID; v_subject UUID;
BEGIN
    SELECT supplementary_session_id, subject_id INTO v_session, v_subject FROM exams WHERE id = NEW.exam_id;
    IF v_session IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM supplementary_eligibility WHERE session_id = v_session AND student_id = NEW.student_id AND subject_id = v_subject
    ) THEN
        RAISE EXCEPTION 'هذا الطالب غير مستحق للامتحان التكميلي لهذه المادة';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_enforce_supplementary_eligibility
    BEFORE INSERT ON grades
    FOR EACH ROW EXECUTE FUNCTION enforce_supplementary_eligibility_on_grades();

-- ---------------------------------------------------------------------
-- النتائج
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_student_supplementary_result WITH (security_invoker = true) AS
WITH thr AS (
    SELECT ses.id AS session_id, COALESCE(gp.passing_threshold_percent, 50) AS pass
    FROM supplementary_sessions ses
    LEFT JOIN grading_policies gp ON gp.account_id = ses.account_id
),
supp AS (
    SELECT e.supplementary_session_id AS session_id, p.student_id, e.subject_id, p.percent AS supp_score
    FROM v_exam_percent p
    JOIN exams e ON e.id = p.exam_id
    WHERE e.supplementary_session_id IS NOT NULL AND p.all_confirmed
)
SELECT el.session_id, el.student_id, el.class_section_id, el.subject_id,
       y.subject_year_score AS year_score,
       s.supp_score,
       ses.mode,
       thr.pass AS pass_threshold,
       CASE
           WHEN s.supp_score IS NULL THEN y.subject_year_score
           WHEN ses.mode = 'replace' THEN s.supp_score
           WHEN ses.mode = 'higher_of' THEN GREATEST(y.subject_year_score, s.supp_score)
           ELSE CASE WHEN s.supp_score >= thr.pass THEN GREATEST(y.subject_year_score, thr.pass)
                     ELSE GREATEST(y.subject_year_score, s.supp_score) END
       END AS final_score,
       (y.subject_year_score >= thr.pass) AS passed_before
FROM supplementary_eligibility el
JOIN supplementary_sessions ses ON ses.id = el.session_id
JOIN thr ON thr.session_id = el.session_id
LEFT JOIN v_student_subject_year y ON y.student_id = el.student_id AND y.subject_id = el.subject_id AND y.class_section_id = el.class_section_id
LEFT JOIN supp s ON s.session_id = el.session_id AND s.student_id = el.student_id AND s.subject_id = el.subject_id;

CREATE OR REPLACE VIEW v_student_promotion WITH (security_invoker = true) AS
WITH thr AS (
    SELECT ses.id AS session_id, COALESCE(gp.passing_threshold_percent, 50) AS pass
    FROM supplementary_sessions ses
    LEFT JOIN grading_policies gp ON gp.account_id = ses.account_id
)
SELECT ses.id AS session_id, y.student_id, y.class_section_id,
       count(*) FILTER (WHERE y.subject_year_score < thr.pass) AS failed_before,
       count(*) FILTER (WHERE COALESCE(r.final_score, y.subject_year_score) < thr.pass) AS failed_after,
       ses.max_failed_subjects,
       (count(*) FILTER (WHERE COALESCE(r.final_score, y.subject_year_score) < thr.pass)) <= ses.max_failed_subjects AS promoted
FROM supplementary_sessions ses
JOIN thr ON thr.session_id = ses.id
JOIN v_student_subject_year y ON y.account_id = ses.account_id
LEFT JOIN v_student_supplementary_result r
       ON r.session_id = ses.id AND r.student_id = y.student_id AND r.subject_id = y.subject_id AND r.class_section_id = y.class_section_id
GROUP BY ses.id, y.student_id, y.class_section_id, ses.max_failed_subjects;

-- المرشّحون: طلاب علامة سنتهم بمادة من مواد الدور أقل من حد النجاح ولم يُضافوا بعد
CREATE OR REPLACE FUNCTION supplementary_candidates(p_session UUID)
RETURNS TABLE (student_id UUID, student_name TEXT, class_section_id UUID, class_name TEXT, subject_id UUID, subject_name TEXT, year_score NUMERIC) AS $$
    SELECT y.student_id, st.full_name, y.class_section_id, cs.name, y.subject_id, sj.name, y.subject_year_score
    FROM supplementary_sessions ses
    JOIN supplementary_subjects ss ON ss.session_id = ses.id
    JOIN v_student_subject_year y ON y.subject_id = ss.subject_id AND y.account_id = ses.account_id
    JOIN students st ON st.id = y.student_id
    JOIN class_sections cs ON cs.id = y.class_section_id
    JOIN subjects sj ON sj.id = y.subject_id
    WHERE ses.id = p_session
      AND ses.account_id = current_account_id()
      AND y.subject_year_score < COALESCE((SELECT passing_threshold_percent FROM grading_policies WHERE account_id = ses.account_id), 50)
      AND NOT EXISTS (SELECT 1 FROM supplementary_eligibility el
                      WHERE el.session_id = ses.id AND el.student_id = y.student_id AND el.subject_id = y.subject_id)
    ORDER BY cs.name, st.full_name, sj.name;
$$ LANGUAGE sql STABLE SET search_path = public;

-- إنشاء امتحان تكميلي لشعبة/مادة ضمن الدور
CREATE OR REPLACE FUNCTION create_supplementary_exam(p_session UUID, p_class UUID, p_subject UUID, p_date DATE, p_max NUMERIC DEFAULT 100)
RETURNS UUID AS $$
DECLARE v_ses supplementary_sessions%ROWTYPE; v_id UUID; v_name TEXT;
BEGIN
    SELECT * INTO v_ses FROM supplementary_sessions WHERE id = p_session AND account_id = current_account_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'الدور التكميلي غير موجود'; END IF;
    IF NOT has_capability_in('supplementary.manage', NULL, p_class, NULL) THEN
        RAISE EXCEPTION 'إنشاء الامتحان التكميلي يتطلب الصلاحية supplementary.manage';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supplementary_eligibility WHERE session_id = p_session AND class_section_id = p_class AND subject_id = p_subject) THEN
        RAISE EXCEPTION 'لا يوجد طلاب مستحقون لهذه المادة بهذه الشعبة';
    END IF;
    IF EXISTS (SELECT 1 FROM exams WHERE supplementary_session_id = p_session AND class_section_id = p_class AND subject_id = p_subject) THEN
        RAISE EXCEPTION 'يوجد امتحان تكميلي لهذه المادة والشعبة مسبقاً';
    END IF;
    SELECT 'تكميلي - ' || sj.name || ' - ' || cs.name INTO v_name
    FROM subjects sj, class_sections cs WHERE sj.id = p_subject AND cs.id = p_class;
    INSERT INTO exams (account_id, class_section_id, subject_id, exam_name, exam_date, max_score, supplementary_session_id)
    VALUES (v_ses.account_id, p_class, p_subject, v_name, p_date, p_max, p_session) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
ALTER TABLE supplementary_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplementary_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplementary_eligibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplementary_sessions_select ON supplementary_sessions FOR SELECT USING (account_id = current_account_id());
CREATE POLICY supplementary_sessions_insert ON supplementary_sessions FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('supplementary.manage'));
CREATE POLICY supplementary_sessions_update ON supplementary_sessions FOR UPDATE USING (account_id = current_account_id() AND has_capability('supplementary.manage')) WITH CHECK (account_id = current_account_id() AND has_capability('supplementary.manage'));
CREATE POLICY supplementary_sessions_delete ON supplementary_sessions FOR DELETE USING (account_id = current_account_id() AND has_capability('supplementary.manage'));

CREATE POLICY supplementary_subjects_select ON supplementary_subjects FOR SELECT
    USING (session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));
CREATE POLICY supplementary_subjects_insert ON supplementary_subjects FOR INSERT
    WITH CHECK (has_capability('supplementary.manage') AND session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));
CREATE POLICY supplementary_subjects_delete ON supplementary_subjects FOR DELETE
    USING (has_capability('supplementary.manage') AND session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));

CREATE POLICY supplementary_eligibility_select ON supplementary_eligibility FOR SELECT
    USING (session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));
CREATE POLICY supplementary_eligibility_insert ON supplementary_eligibility FOR INSERT
    WITH CHECK (has_capability_in('supplementary.manage', NULL, class_section_id, NULL)
                AND session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));
CREATE POLICY supplementary_eligibility_delete ON supplementary_eligibility FOR DELETE
    USING (has_capability_in('supplementary.manage', NULL, class_section_id, NULL)
           AND session_id IN (SELECT id FROM supplementary_sessions WHERE account_id = current_account_id()));

-- ---------------------------------------------------------------------
-- صلاحيات التنفيذ + الناظر العام يحصل على الصلاحية افتراضياً
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.supplementary_candidates(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_supplementary_exam(uuid, uuid, uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplementary_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplementary_exam(uuid, uuid, uuid, date, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION apply_default_capabilities(p_app_user_id uuid, p_role user_role_enum)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin
  delete from user_capabilities where app_user_id = p_app_user_id;

  if p_role = 'solo_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    select p_app_user_id, key from capabilities;
  elsif p_role = 'school_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'window.toggle'),
           (p_app_user_id, 'reports.view'), (p_app_user_id, 'reports.export'),
           (p_app_user_id, 'config.manage'), (p_app_user_id, 'users.manage'),
           (p_app_user_id, 'notifications.send'), (p_app_user_id, 'roster.manage'),
           (p_app_user_id, 'grading.adjust'), (p_app_user_id, 'teaching.approve_secondary'),
           (p_app_user_id, 'supplementary.manage'), (p_app_user_id, 'records.import_manage'),
           (p_app_user_id, 'grades.finalize_submission'), (p_app_user_id, 'grades.edit_others'),
           (p_app_user_id, 'building.manage');
  elsif p_role = 'assistant_admin' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter'), (p_app_user_id, 'grades.edit_others'),
           (p_app_user_id, 'grades.view_all'), (p_app_user_id, 'roster.manage');
  elsif p_role = 'subject_teacher' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'grades.enter');
  elsif p_role = 'custom_role' then
    insert into user_capabilities (app_user_id, capability_key)
    values (p_app_user_id, 'reports.view');
  end if;
end;
$function$;
-- =====================================================================
