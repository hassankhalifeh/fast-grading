-- =====================================================================
-- 24_teacher_assignments.sql
-- إسناد الأساتذة بقاعدة الحصرية: أستاذ أساسي واحد فقط لكل (شعبة، مادة).
-- أستاذ ثانٍ لنفس المادة والشعبة مسموح فقط بموافقة الناظر العام عبر طلب
-- (teaching_assignment_requests) - ولا يُدرج مباشرة بأي طريقة أخرى.
-- =====================================================================

ALTER TABLE class_subject_teachers
    ADD COLUMN assignment_role TEXT NOT NULL DEFAULT 'primary' CHECK (assignment_role IN ('primary', 'secondary')),
    ADD COLUMN approved_by     UUID REFERENCES app_users(id),
    ADD COLUMN approved_at     TIMESTAMPTZ,
    ADD COLUMN note            TEXT;

CREATE UNIQUE INDEX class_subject_teachers_one_primary
    ON class_subject_teachers (class_section_id, subject_id) WHERE assignment_role = 'primary';
CREATE UNIQUE INDEX class_subject_teachers_teacher_once
    ON class_subject_teachers (class_section_id, subject_id, teacher_id);
CREATE INDEX class_subject_teachers_class_idx ON class_subject_teachers (class_section_id);

-- سلامة الحساب: الشعبة والمادة والأستاذ لازم يتبعوا نفس الحساب، والأستاذ فعّال
CREATE OR REPLACE FUNCTION validate_class_subject_teacher()
RETURNS TRIGGER AS $$
DECLARE v_class_acc UUID; v_subj_acc UUID; v_teacher_acc UUID; v_active BOOLEAN;
BEGIN
    SELECT account_id INTO v_class_acc FROM class_sections WHERE id = NEW.class_section_id;
    SELECT account_id INTO v_subj_acc  FROM subjects WHERE id = NEW.subject_id;
    SELECT account_id, is_active INTO v_teacher_acc, v_active FROM app_users WHERE id = NEW.teacher_id;
    IF v_class_acc IS DISTINCT FROM v_subj_acc OR v_class_acc IS DISTINCT FROM v_teacher_acc THEN
        RAISE EXCEPTION 'الشعبة والمادة والأستاذ يجب أن يتبعوا نفس الحساب';
    END IF;
    IF NOT v_active THEN
        RAISE EXCEPTION 'لا يمكن إسناد مادة لمستخدم غير فعّال';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_class_subject_teacher
    BEFORE INSERT OR UPDATE ON class_subject_teachers
    FOR EACH ROW EXECUTE FUNCTION validate_class_subject_teacher();

-- ---------------------------------------------------------------------
-- طلبات الأستاذ الثاني
-- ---------------------------------------------------------------------
CREATE TABLE teaching_assignment_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
    subject_id       UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id       UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    requested_by     UUID NOT NULL REFERENCES app_users(id),
    reason           TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by       UUID REFERENCES app_users(id),
    decided_at       TIMESTAMPTZ,
    decision_note    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teaching_requests_one_pending
    ON teaching_assignment_requests (class_section_id, subject_id, teacher_id) WHERE status = 'pending';
CREATE INDEX teaching_requests_account_idx ON teaching_assignment_requests (account_id, status);
CREATE INDEX teaching_requests_class_idx ON teaching_assignment_requests (class_section_id);
CREATE INDEX teaching_requests_subject_idx ON teaching_assignment_requests (subject_id);
CREATE INDEX teaching_requests_teacher_idx ON teaching_assignment_requests (teacher_id);
CREATE INDEX teaching_requests_requester_idx ON teaching_assignment_requests (requested_by);

ALTER TABLE teaching_assignment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY teaching_requests_select ON teaching_assignment_requests
    FOR SELECT USING (account_id = current_account_id());

-- تقديم الطلب: أدوار الإدارة فقط، وباسم صاحب الجلسة. القرار عبر الدالة أدناه فقط (لا UPDATE مباشر)
CREATE POLICY teaching_requests_insert ON teaching_assignment_requests
    FOR INSERT WITH CHECK (
        account_id = current_account_id()
        AND status = 'pending'
        AND requested_by = current_app_user_id()
        AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
    );

-- ---------------------------------------------------------------------
-- الصلاحية + سياسات class_subject_teachers المحدّثة
-- ---------------------------------------------------------------------
INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'teaching.approve_secondary', 'الموافقة على أستاذ ثانٍ لنفس المادة والشعبة', 'Admin', id, 'modify'
FROM permission_resources WHERE code = 'roster'
ON CONFLICT (key) DO NOTHING;

-- الإدراج المباشر للأستاذ الأساسي فقط، والثانوي عبر الموافقة
DROP POLICY class_subject_teachers_insert ON class_subject_teachers;
CREATE POLICY class_subject_teachers_insert ON class_subject_teachers FOR INSERT WITH CHECK (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

-- تعديل الأستاذ الأساسي فقط (تبديله)، الثانوي يُحذف ولا يُعدَّل
DROP POLICY class_subject_teachers_update ON class_subject_teachers;
CREATE POLICY class_subject_teachers_update ON class_subject_teachers FOR UPDATE USING (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
) WITH CHECK (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND (SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
);

-- ---------------------------------------------------------------------
-- قرار الناظر العام على الطلب
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decide_teaching_request(p_request UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    v_req teaching_assignment_requests%ROWTYPE;
    v_me UUID := current_app_user_id();
BEGIN
    IF NOT has_capability('teaching.approve_secondary') THEN
        RAISE EXCEPTION 'الموافقة على أستاذ ثانٍ من صلاحية الناظر العام فقط';
    END IF;

    SELECT * INTO v_req FROM teaching_assignment_requests
    WHERE id = p_request AND account_id = current_account_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;
    IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'تم البت بهذا الطلب مسبقاً'; END IF;

    IF p_approve THEN
        IF NOT EXISTS (SELECT 1 FROM class_subject_teachers
                       WHERE class_section_id = v_req.class_section_id AND subject_id = v_req.subject_id
                         AND assignment_role = 'primary') THEN
            RAISE EXCEPTION 'لا يوجد أستاذ أساسي لهذه المادة والشعبة - عيّنه أولاً';
        END IF;
        INSERT INTO class_subject_teachers (class_section_id, subject_id, teacher_id, assignment_role, approved_by, approved_at, note)
        VALUES (v_req.class_section_id, v_req.subject_id, v_req.teacher_id, 'secondary', v_me, now(), v_req.reason);
    END IF;

    UPDATE teaching_assignment_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        decided_by = v_me, decided_at = now(), decision_note = p_note
    WHERE id = p_request;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_req.account_id, v_me, 'update', 'teaching_assignment_requests', p_request,
            jsonb_build_object('event', 'teaching_request_decided', 'approved', p_approve, 'note', p_note));

    RETURN CASE WHEN p_approve THEN 'تمت الموافقة وإضافة الأستاذ الثاني' ELSE 'تم رفض الطلب' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.decide_teaching_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_teaching_request(uuid, boolean, text) TO authenticated;

-- الناظر العام يحصل على الصلاحية افتراضياً
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
           (p_app_user_id, 'grading.adjust'), (p_app_user_id, 'teaching.approve_secondary');
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
