-- =====================================================================
-- 26_org_structure.sql
-- الهيكل التنظيمي:
--  * مبنى ← طابق ← شعبة (اختياري: المدرسة الصغيرة تتجاهل المباني/الطوابق)
--  * ملكية حصرية للنظّار بأربعة مستويات: صف / طابق / مرحلة / مبنى
--    - ناظر واحد فقط لكل شعبة، ولكل طابق، ولكل مرحلة، ولكل مبنى (قيود فريدة)
--    - مساعدون بلا حد؛ نطاقهم نفس نطاق ناظرهم (لا يتجاوزه)
--    - ناظر المرحلة صاحب الشأن التعليمي عبر المباني؛ ناظر المبنى محصور بإدارة
--      المبنى (building.manage) فقط
--  * صلاحيات كل مستوى قابلة للتعديل من لوحة الصلاحيات (افتراضيات نظامية)
--  * مبدأ الصعود: عند غياب الأدنى تنتقل المسؤولية لأول أعلى موجود حتى الناظر العام،
--    والأعلى ينفّذ بدل الأدنى (صلاحيات المستوى الأعلى تغطي نطاقه بما فيه شعب الأدنى)
-- =====================================================================

CREATE TABLE buildings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id),
    name        TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX buildings_account_idx ON buildings(account_id);

CREATE TABLE floors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id),
    building_id UUID REFERENCES buildings(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX floors_account_idx ON floors(account_id);
CREATE INDEX floors_building_idx ON floors(building_id);

ALTER TABLE class_sections ADD COLUMN floor_id UUID REFERENCES floors(id) ON DELETE SET NULL;
CREATE INDEX class_sections_floor_idx ON class_sections(floor_id);
CREATE INDEX class_sections_stage_idx ON class_sections(stage_id);

INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'building.manage', 'إدارة المبنى (الطوابق وتوزيع الشعب) دون الشأن التعليمي', 'Admin', id, 'modify'
FROM permission_resources WHERE code = 'config'
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- الملكية
-- ---------------------------------------------------------------------
CREATE TYPE supervision_level_enum AS ENUM ('class', 'floor', 'stage', 'building');

CREATE TABLE supervisions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    level            supervision_level_enum NOT NULL,
    supervisor_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    class_section_id UUID REFERENCES class_sections(id) ON DELETE CASCADE,
    floor_id         UUID REFERENCES floors(id) ON DELETE CASCADE,
    stage_id         UUID REFERENCES stages(id) ON DELETE CASCADE,
    building_id      UUID REFERENCES buildings(id) ON DELETE CASCADE,
    created_by       UUID REFERENCES app_users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supervisions_target_ck CHECK (
        (level = 'class'    AND class_section_id IS NOT NULL AND floor_id IS NULL AND stage_id IS NULL AND building_id IS NULL) OR
        (level = 'floor'    AND floor_id IS NOT NULL AND class_section_id IS NULL AND stage_id IS NULL AND building_id IS NULL) OR
        (level = 'stage'    AND stage_id IS NOT NULL AND class_section_id IS NULL AND floor_id IS NULL AND building_id IS NULL) OR
        (level = 'building' AND building_id IS NOT NULL AND class_section_id IS NULL AND floor_id IS NULL AND stage_id IS NULL)
    )
);
-- ناظر واحد فقط لكل هدف
CREATE UNIQUE INDEX supervisions_one_per_class    ON supervisions (class_section_id) WHERE level = 'class';
CREATE UNIQUE INDEX supervisions_one_per_floor    ON supervisions (floor_id)         WHERE level = 'floor';
CREATE UNIQUE INDEX supervisions_one_per_stage    ON supervisions (stage_id)         WHERE level = 'stage';
CREATE UNIQUE INDEX supervisions_one_per_building ON supervisions (building_id)      WHERE level = 'building';
CREATE INDEX supervisions_account_idx    ON supervisions (account_id);
CREATE INDEX supervisions_supervisor_idx ON supervisions (supervisor_id);

CREATE TABLE supervision_assistants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supervision_id UUID NOT NULL REFERENCES supervisions(id) ON DELETE CASCADE,
    assistant_id   UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (supervision_id, assistant_id)
);
CREATE INDEX supervision_assistants_assistant_idx ON supervision_assistants (assistant_id);

-- المدير العام (school_admin) والمعلم المستقل لا يكونون نظّار مستويات أو مساعدين:
-- هم أعلى مستوى أصلاً وصلاحيتهم عامة
CREATE OR REPLACE FUNCTION validate_supervision()
RETURNS TRIGGER AS $$
DECLARE v_target_acc UUID; v_sup_acc UUID; v_active BOOLEAN; v_role user_role_enum;
BEGIN
    v_target_acc := CASE NEW.level
        WHEN 'class'    THEN (SELECT account_id FROM class_sections WHERE id = NEW.class_section_id)
        WHEN 'floor'    THEN (SELECT account_id FROM floors WHERE id = NEW.floor_id)
        WHEN 'stage'    THEN (SELECT account_id FROM stages WHERE id = NEW.stage_id)
        WHEN 'building' THEN (SELECT account_id FROM buildings WHERE id = NEW.building_id)
    END;
    SELECT account_id, is_active, role INTO v_sup_acc, v_active, v_role FROM app_users WHERE id = NEW.supervisor_id;
    IF NEW.account_id IS DISTINCT FROM v_target_acc OR NEW.account_id IS DISTINCT FROM v_sup_acc THEN
        RAISE EXCEPTION 'الناظر والهدف يجب أن يتبعوا نفس الحساب';
    END IF;
    IF NOT v_active THEN RAISE EXCEPTION 'لا يمكن تعيين مستخدم غير فعّال ناظراً'; END IF;
    IF v_role IN ('solo_teacher', 'school_admin') THEN
        RAISE EXCEPTION 'الناظر العام صلاحيته عامة أصلاً ولا يُعيَّن ناظراً لمستوى';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_supervision
    BEFORE INSERT OR UPDATE ON supervisions
    FOR EACH ROW EXECUTE FUNCTION validate_supervision();

CREATE OR REPLACE FUNCTION validate_supervision_assistant()
RETURNS TRIGGER AS $$
DECLARE v_sup supervisions%ROWTYPE; v_acc UUID; v_active BOOLEAN; v_role user_role_enum;
BEGIN
    SELECT * INTO v_sup FROM supervisions WHERE id = NEW.supervision_id;
    SELECT account_id, is_active, role INTO v_acc, v_active, v_role FROM app_users WHERE id = NEW.assistant_id;
    IF v_acc IS DISTINCT FROM v_sup.account_id THEN RAISE EXCEPTION 'المساعد يجب أن يتبع نفس الحساب'; END IF;
    IF NOT v_active THEN RAISE EXCEPTION 'لا يمكن تعيين مستخدم غير فعّال مساعداً'; END IF;
    IF NEW.assistant_id = v_sup.supervisor_id THEN RAISE EXCEPTION 'الناظر لا يكون مساعداً لنفسه'; END IF;
    IF v_role IN ('solo_teacher', 'school_admin') THEN RAISE EXCEPTION 'الناظر العام لا يُعيَّن مساعداً'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_supervision_assistant
    BEFORE INSERT OR UPDATE ON supervision_assistants
    FOR EACH ROW EXECUTE FUNCTION validate_supervision_assistant();

-- ---------------------------------------------------------------------
-- صلاحيات كل مستوى: افتراضيات نظامية (account_id NULL) + تخصيص لكل حساب
-- (إن وُجد أي صف للحساب على مستوى معيّن فهو يحل محل الافتراضي لذلك المستوى كاملاً)
-- ---------------------------------------------------------------------
CREATE TABLE supervision_level_capabilities (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
    level          supervision_level_enum NOT NULL,
    capability_key TEXT NOT NULL REFERENCES capabilities(key) ON DELETE CASCADE
);
CREATE TABLE supervision_levels_customized (
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    level      supervision_level_enum NOT NULL,
    PRIMARY KEY (account_id, level)
);

CREATE UNIQUE INDEX supervision_level_capabilities_uidx ON supervision_level_capabilities
    (COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), level, capability_key);
CREATE INDEX supervision_level_capabilities_key_idx ON supervision_level_capabilities (capability_key);

INSERT INTO supervision_level_capabilities (account_id, level, capability_key) VALUES
    (NULL, 'class',    'roster.manage'),
    (NULL, 'class',    'grades.view_all'),
    (NULL, 'class',    'grades.edit_others'),
    (NULL, 'class',    'reports.view'),
    (NULL, 'stage',    'roster.manage'),
    (NULL, 'stage',    'grades.view_all'),
    (NULL, 'stage',    'grades.edit_others'),
    (NULL, 'stage',    'grading.adjust'),
    (NULL, 'stage',    'reports.view'),
    (NULL, 'stage',    'reports.export'),
    (NULL, 'stage',    'window.toggle'),
    (NULL, 'stage',    'notifications.send'),
    (NULL, 'floor',    'roster.manage'),
    (NULL, 'floor',    'grades.view_all'),
    (NULL, 'floor',    'reports.view'),
    (NULL, 'building', 'building.manage');

CREATE OR REPLACE FUNCTION supervision_level_has(p_account UUID, p_level supervision_level_enum, p_key TEXT)
RETURNS BOOLEAN AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM supervision_levels_customized WHERE account_id = p_account AND level = p_level)
        THEN EXISTS (SELECT 1 FROM supervision_level_capabilities WHERE account_id = p_account AND level = p_level AND capability_key = p_key)
        ELSE EXISTS (SELECT 1 FROM supervision_level_capabilities WHERE account_id IS NULL AND level = p_level AND capability_key = p_key)
    END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- has_capability_in يشمل الآن صلاحيات الملكية (ناظر/مساعد) ضمن نطاق ملكيته
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_capability_in(p_key TEXT, p_stage UUID, p_class UUID, p_subject UUID)
RETURNS BOOLEAN AS $$
    SELECT has_capability(p_key)
    OR EXISTS (
        SELECT 1
        FROM user_scoped_capabilities usc
        JOIN app_users au ON au.id = usc.app_user_id
        WHERE au.auth_uid = auth.uid()
          AND au.is_active
          AND usc.capability_key = p_key
          AND group_covers(usc.group_id, p_stage, p_class, p_subject)
    )
    OR EXISTS (
        SELECT 1
        FROM app_users me
        JOIN supervisions s ON s.account_id = me.account_id
        LEFT JOIN class_sections cs ON cs.id = p_class
        LEFT JOIN floors f ON f.id = cs.floor_id
        WHERE me.auth_uid = auth.uid() AND me.is_active
          AND (s.supervisor_id = me.id
               OR EXISTS (SELECT 1 FROM supervision_assistants sa WHERE sa.supervision_id = s.id AND sa.assistant_id = me.id))
          AND supervision_level_has(s.account_id, s.level, p_key)
          AND (
               (s.level = 'class'    AND p_class IS NOT NULL AND s.class_section_id = p_class)
            OR (s.level = 'stage'    AND s.stage_id = COALESCE(cs.stage_id, p_stage))
            OR (s.level = 'floor'    AND p_class IS NOT NULL AND s.floor_id = cs.floor_id)
            OR (s.level = 'building' AND p_class IS NOT NULL AND s.building_id = f.building_id)
          )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- هل أحمل (كناظر) مستوى أعلى من الصف يغطي هذه الشعبة؟ (مرحلة أو طابق) - للتعيين بدل الأدنى
CREATE OR REPLACE FUNCTION holds_supervision_over_class(p_class UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM app_users me
        JOIN supervisions s ON s.account_id = me.account_id AND s.supervisor_id = me.id
        JOIN class_sections cs ON cs.id = p_class
        WHERE me.auth_uid = auth.uid() AND me.is_active
          AND ((s.level = 'stage' AND s.stage_id = cs.stage_id)
            OR (s.level = 'floor' AND s.floor_id = cs.floor_id))
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION can_manage_building(p_building UUID)
RETURNS BOOLEAN AS $$
    SELECT has_capability('config.manage')
        OR (p_building IS NOT NULL AND EXISTS (
            SELECT 1 FROM app_users me
            JOIN supervisions s ON s.account_id = me.account_id AND s.supervisor_id = me.id
            WHERE me.auth_uid = auth.uid() AND me.is_active
              AND s.level = 'building' AND s.building_id = p_building
              AND supervision_level_has(s.account_id, 'building', 'building.manage')));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION can_assign_supervision(p_level supervision_level_enum, p_class UUID)
RETURNS BOOLEAN AS $$
    SELECT has_capability('users.manage')
        OR (p_level = 'class' AND p_class IS NOT NULL AND holds_supervision_over_class(p_class));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION can_manage_assistants(p_supervision UUID)
RETURNS BOOLEAN AS $$
    SELECT has_capability('users.manage')
        OR EXISTS (
            SELECT 1 FROM supervisions s
            JOIN app_users me ON me.auth_uid = auth.uid() AND me.is_active
            WHERE s.id = p_supervision AND s.account_id = me.account_id
              AND (s.supervisor_id = me.id
                   OR (s.level = 'class' AND holds_supervision_over_class(s.class_section_id)))
        );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- من هو صاحب المسؤولية الفعلي عن شعبة؟ (الأدنى الموجود، وإلا صعوداً حتى الناظر العام)
-- الترتيب التعليمي: ناظر الصف ← ناظر المرحلة ← ناظر الطابق ← الناظر العام.
-- ناظر المبنى خارج السلسلة التعليمية (إدارة المبنى فقط).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION class_effective_authority(p_class UUID)
RETURNS TABLE (level TEXT, user_id UUID) AS $$
    (
        SELECT s.level::TEXT, s.supervisor_id
        FROM supervisions s
        JOIN class_sections cs ON cs.id = p_class
        WHERE (s.level = 'class' AND s.class_section_id = cs.id)
           OR (s.level = 'stage' AND s.stage_id = cs.stage_id)
           OR (s.level = 'floor' AND s.floor_id = cs.floor_id)
        ORDER BY CASE s.level WHEN 'class' THEN 1 WHEN 'stage' THEN 2 ELSE 3 END
        LIMIT 1
    )
    UNION ALL
    (
        SELECT 'principal', au.id
        FROM app_users au
        JOIN class_sections cs ON cs.id = p_class AND cs.account_id = au.account_id
        WHERE au.is_active AND au.role IN ('school_admin', 'solo_teacher')
          AND NOT EXISTS (
              SELECT 1 FROM supervisions s
              WHERE (s.level = 'class' AND s.class_section_id = cs.id)
                 OR (s.level = 'stage' AND s.stage_id = cs.stage_id)
                 OR (s.level = 'floor' AND s.floor_id = cs.floor_id))
        ORDER BY CASE au.role WHEN 'school_admin' THEN 1 ELSE 2 END
        LIMIT 1
    );
$$ LANGUAGE sql STABLE SET search_path = public;

-- نظرة عامة للشاشة: كل شعبة بمن يشرف عليها فعلياً وبالمواد التي بلا أستاذ
CREATE OR REPLACE FUNCTION org_overview()
RETURNS TABLE (
    class_id UUID, class_name TEXT, stage_name TEXT, floor_name TEXT, building_name TEXT,
    class_supervisor UUID, authority_level TEXT, authority_user UUID,
    assistants_count BIGINT, subjects_without_teacher BIGINT
) AS $$
    SELECT cs.id, cs.name, st.stage_name, f.name, b.name,
           (SELECT s.supervisor_id FROM supervisions s WHERE s.level = 'class' AND s.class_section_id = cs.id),
           (SELECT a.level FROM class_effective_authority(cs.id) a),
           (SELECT a.user_id FROM class_effective_authority(cs.id) a),
           (SELECT count(*) FROM supervisions s JOIN supervision_assistants sa ON sa.supervision_id = s.id
             WHERE s.level = 'class' AND s.class_section_id = cs.id),
           (SELECT count(*) FROM subjects sj
             WHERE sj.account_id = cs.account_id
               AND NOT EXISTS (SELECT 1 FROM class_subject_teachers t
                                WHERE t.class_section_id = cs.id AND t.subject_id = sj.id AND t.assignment_role = 'primary'))
    FROM class_sections cs
    LEFT JOIN stages st ON st.id = cs.stage_id
    LEFT JOIN floors f ON f.id = cs.floor_id
    LEFT JOIN buildings b ON b.id = f.building_id
    WHERE cs.account_id = current_account_id()
    ORDER BY st.order_index NULLS LAST, cs.name;
$$ LANGUAGE sql STABLE SET search_path = public;

-- نقل شعبة لطابق: تتطلب صلاحية على مبنى الطابق الجديد (وعلى القديم إن وُجد)
CREATE OR REPLACE FUNCTION assign_class_floor(p_class UUID, p_floor UUID)
RETURNS TEXT AS $$
DECLARE v_acc UUID := current_account_id(); v_old_building UUID; v_new_building UUID; v_old_floor UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM class_sections WHERE id = p_class AND account_id = v_acc) THEN
        RAISE EXCEPTION 'الشعبة غير موجودة';
    END IF;
    SELECT floor_id INTO v_old_floor FROM class_sections WHERE id = p_class;
    SELECT building_id INTO v_old_building FROM floors WHERE id = v_old_floor;
    IF p_floor IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM floors WHERE id = p_floor AND account_id = v_acc) THEN
            RAISE EXCEPTION 'الطابق غير موجود';
        END IF;
        SELECT building_id INTO v_new_building FROM floors WHERE id = p_floor;
    END IF;
    IF NOT can_manage_building(v_new_building) OR (v_old_floor IS NOT NULL AND NOT can_manage_building(v_old_building)) THEN
        RAISE EXCEPTION 'ليس لديك صلاحية على هذا المبنى';
    END IF;
    UPDATE class_sections SET floor_id = p_floor WHERE id = p_class;
    RETURN 'تم تحديث موقع الشعبة';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- تخصيص صلاحيات مستوى لحساب: أول تعديل ينسخ الافتراضي لذلك المستوى ثم يعدّل
CREATE OR REPLACE FUNCTION set_level_capability(p_level supervision_level_enum, p_key TEXT, p_granted BOOLEAN)
RETURNS TEXT AS $$
DECLARE v_acc UUID := current_account_id();
BEGIN
    IF NOT has_capability('users.manage') THEN RAISE EXCEPTION 'يتطلب الصلاحية users.manage'; END IF;
    IF p_level = 'building' AND p_key <> 'building.manage' AND p_granted THEN
        RAISE EXCEPTION 'ناظر المبنى محصور بإدارة المبنى ولا يُمنح صلاحيات تعليمية';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supervision_levels_customized WHERE account_id = v_acc AND level = p_level) THEN
        INSERT INTO supervision_levels_customized (account_id, level) VALUES (v_acc, p_level);
        INSERT INTO supervision_level_capabilities (account_id, level, capability_key)
        SELECT v_acc, level, capability_key FROM supervision_level_capabilities WHERE account_id IS NULL AND level = p_level;
    END IF;
    IF p_granted THEN
        INSERT INTO supervision_level_capabilities (account_id, level, capability_key) VALUES (v_acc, p_level, p_key) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM supervision_level_capabilities WHERE account_id = v_acc AND level = p_level AND capability_key = p_key;
    END IF;
    RETURN 'تم التحديث';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_assistants ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_level_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_levels_customized ENABLE ROW LEVEL SECURITY;

CREATE POLICY buildings_select ON buildings FOR SELECT USING (account_id = current_account_id());
CREATE POLICY buildings_insert ON buildings FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY buildings_update ON buildings FOR UPDATE USING (account_id = current_account_id() AND has_capability('config.manage')) WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY buildings_delete ON buildings FOR DELETE USING (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY floors_select ON floors FOR SELECT USING (account_id = current_account_id());
CREATE POLICY floors_insert ON floors FOR INSERT WITH CHECK (account_id = current_account_id() AND can_manage_building(building_id));
CREATE POLICY floors_update ON floors FOR UPDATE USING (account_id = current_account_id() AND can_manage_building(building_id)) WITH CHECK (account_id = current_account_id() AND can_manage_building(building_id));
CREATE POLICY floors_delete ON floors FOR DELETE USING (account_id = current_account_id() AND can_manage_building(building_id));

CREATE POLICY supervisions_select ON supervisions FOR SELECT USING (account_id = current_account_id());
CREATE POLICY supervisions_insert ON supervisions FOR INSERT WITH CHECK (account_id = current_account_id() AND can_assign_supervision(level, class_section_id));
CREATE POLICY supervisions_update ON supervisions FOR UPDATE USING (account_id = current_account_id() AND can_assign_supervision(level, class_section_id)) WITH CHECK (account_id = current_account_id() AND can_assign_supervision(level, class_section_id));
CREATE POLICY supervisions_delete ON supervisions FOR DELETE USING (account_id = current_account_id() AND can_assign_supervision(level, class_section_id));

CREATE POLICY supervision_assistants_select ON supervision_assistants FOR SELECT
    USING (supervision_id IN (SELECT id FROM supervisions WHERE account_id = current_account_id()));
CREATE POLICY supervision_assistants_insert ON supervision_assistants FOR INSERT
    WITH CHECK (supervision_id IN (SELECT id FROM supervisions WHERE account_id = current_account_id()) AND can_manage_assistants(supervision_id));
CREATE POLICY supervision_assistants_delete ON supervision_assistants FOR DELETE
    USING (supervision_id IN (SELECT id FROM supervisions WHERE account_id = current_account_id()) AND can_manage_assistants(supervision_id));

CREATE POLICY supervision_level_capabilities_select ON supervision_level_capabilities FOR SELECT
    USING (account_id IS NULL OR account_id = current_account_id());
CREATE POLICY supervision_levels_customized_select ON supervision_levels_customized FOR SELECT
    USING (account_id = current_account_id());

-- ---------------------------------------------------------------------
-- إسناد الأساتذة: ناظر الصف (أو الأعلى منه ضمن نطاقه) يقدر يدير أساتذة شعبته، وليس فقط أدوار الإدارة
-- ---------------------------------------------------------------------
DROP POLICY class_subject_teachers_insert ON class_subject_teachers;
CREATE POLICY class_subject_teachers_insert ON class_subject_teachers FOR INSERT WITH CHECK (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
         OR has_capability_in('roster.manage', NULL, class_section_id, NULL))
);
DROP POLICY class_subject_teachers_update ON class_subject_teachers;
CREATE POLICY class_subject_teachers_update ON class_subject_teachers FOR UPDATE USING (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
         OR has_capability_in('roster.manage', NULL, class_section_id, NULL))
) WITH CHECK (
    assignment_role = 'primary'
    AND class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
         OR has_capability_in('roster.manage', NULL, class_section_id, NULL))
);
DROP POLICY class_subject_teachers_delete ON class_subject_teachers;
CREATE POLICY class_subject_teachers_delete ON class_subject_teachers FOR DELETE USING (
    class_section_id IN (SELECT id FROM class_sections WHERE account_id = current_account_id())
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
         OR has_capability_in('roster.manage', NULL, class_section_id, NULL))
);
DROP POLICY teaching_requests_insert ON teaching_assignment_requests;
CREATE POLICY teaching_requests_insert ON teaching_assignment_requests FOR INSERT WITH CHECK (
    account_id = current_account_id()
    AND status = 'pending'
    AND requested_by = current_app_user_id()
    AND ((SELECT role FROM current_app_user()) = ANY (ARRAY['solo_teacher','school_admin','assistant_admin']::user_role_enum[])
         OR has_capability_in('roster.manage', NULL, class_section_id, NULL))
);

-- ---------------------------------------------------------------------
-- صلاحيات التنفيذ
-- ---------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'supervision_level_has(uuid, supervision_level_enum, text)',
        'holds_supervision_over_class(uuid)', 'can_manage_building(uuid)',
        'can_assign_supervision(supervision_level_enum, uuid)', 'can_manage_assistants(uuid)',
        'class_effective_authority(uuid)', 'org_overview()', 'assign_class_floor(uuid, uuid)',
        'set_level_capability(supervision_level_enum, text, boolean)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
-- =====================================================================
