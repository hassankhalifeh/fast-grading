-- =====================================================================
-- 20_academic_structure_and_scopes.sql
-- 1) الهيكل الأكاديمي المرن: سنة دراسية ← فصول ← بنود تقييم (سعي/امتحان فصل..)
--    والامتحان يُربط ببند. عدد الفصول والبنود يحدده كل مدرسة (لا شيء ثابت بالكود).
-- 2) تجاوزات النسب (grading_overrides) بنطاقات: مدرسة / مرحلة / صف / مادة / صف+مادة
--    والأخص يغلب الأعم. الافتراضي تلقائي، والتجاوز يدوي من الناظر ضمن صلاحيته.
--    وزن 0 لبند = "غير مفعّل" لذلك النطاق (يُستبعد من المعدل).
-- 3) مجموعات نطاق مرنة (مرحلة / طابق / قسم / أي مزيج) وصلاحيات مقيّدة بها،
--    عشان تُنشأ أدوار مثل ناظر مرحلة أو رئيس قسم من لوحة الصلاحيات بدون كود.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) السنوات والفصول والبنود
-- ---------------------------------------------------------------------
CREATE TABLE academic_years (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id),
    name        TEXT NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX academic_years_one_current ON academic_years(account_id) WHERE is_current;
CREATE INDEX academic_years_account_idx ON academic_years(account_id);

ALTER TABLE terms
    ADD COLUMN academic_year_id UUID REFERENCES academic_years(id),
    ADD COLUMN order_index      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN default_weight   NUMERIC CHECK (default_weight IS NULL OR default_weight >= 0);
CREATE INDEX terms_year_idx ON terms(academic_year_id);

CREATE TYPE assessment_kind_enum AS ENUM ('coursework', 'term_exam', 'other');

CREATE TABLE assessment_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id           UUID NOT NULL REFERENCES accounts(id),
    term_id              UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    kind                 assessment_kind_enum NOT NULL DEFAULT 'coursework',
    order_index          INTEGER NOT NULL DEFAULT 0,
    default_weight       NUMERIC CHECK (default_weight IS NULL OR default_weight >= 0),
    default_template_id  UUID REFERENCES exam_types(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assessment_items_term_idx ON assessment_items(term_id);
CREATE INDEX assessment_items_account_idx ON assessment_items(account_id);

ALTER TABLE exams ADD COLUMN item_id UUID REFERENCES assessment_items(id);
CREATE INDEX exams_item_idx ON exams(item_id);

-- الفصل يُشتق من البند (يبقى exams.term_id متزامناً لأي view/تقرير يعتمد عليه)
CREATE OR REPLACE FUNCTION sync_exam_term_from_item()
RETURNS TRIGGER AS $$
DECLARE v_term UUID; v_acc UUID;
BEGIN
    IF NEW.item_id IS NOT NULL THEN
        SELECT term_id, account_id INTO v_term, v_acc FROM assessment_items WHERE id = NEW.item_id;
        IF v_acc IS DISTINCT FROM NEW.account_id THEN
            RAISE EXCEPTION 'بند التقييم لا يتبع نفس حساب الامتحان';
        END IF;
        NEW.term_id := v_term;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_sync_exam_term_from_item
    BEFORE INSERT OR UPDATE OF item_id ON exams
    FOR EACH ROW EXECUTE FUNCTION sync_exam_term_from_item();

-- ---------------------------------------------------------------------
-- 2) تجاوزات النسب بالنطاقات
-- ---------------------------------------------------------------------
CREATE TYPE override_scope_enum  AS ENUM ('school', 'stage', 'class', 'subject', 'class_subject');
CREATE TYPE override_target_enum AS ENUM ('term_weight', 'item_weight', 'exam_weight');

CREATE TABLE grading_overrides (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id),
    scope            override_scope_enum NOT NULL,
    stage_id         UUID REFERENCES stages(id) ON DELETE CASCADE,
    class_section_id UUID REFERENCES class_sections(id) ON DELETE CASCADE,
    subject_id       UUID REFERENCES subjects(id) ON DELETE CASCADE,
    target           override_target_enum NOT NULL,
    term_id          UUID REFERENCES terms(id) ON DELETE CASCADE,
    item_id          UUID REFERENCES assessment_items(id) ON DELETE CASCADE,
    exam_id          UUID REFERENCES exams(id) ON DELETE CASCADE,
    value            NUMERIC NOT NULL CHECK (value >= 0),
    note             TEXT,
    created_by       UUID REFERENCES app_users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT grading_overrides_scope_ck CHECK (
        (scope = 'school'        AND stage_id IS NULL AND class_section_id IS NULL AND subject_id IS NULL) OR
        (scope = 'stage'         AND stage_id IS NOT NULL AND class_section_id IS NULL AND subject_id IS NULL) OR
        (scope = 'class'         AND class_section_id IS NOT NULL AND stage_id IS NULL AND subject_id IS NULL) OR
        (scope = 'subject'       AND subject_id IS NOT NULL AND stage_id IS NULL AND class_section_id IS NULL) OR
        (scope = 'class_subject' AND class_section_id IS NOT NULL AND subject_id IS NOT NULL AND stage_id IS NULL)
    ),
    CONSTRAINT grading_overrides_target_ck CHECK (
        (target = 'term_weight' AND term_id IS NOT NULL AND item_id IS NULL AND exam_id IS NULL) OR
        (target = 'item_weight' AND item_id IS NOT NULL AND term_id IS NULL AND exam_id IS NULL) OR
        (target = 'exam_weight' AND exam_id IS NOT NULL AND term_id IS NULL AND item_id IS NULL)
    )
);
CREATE UNIQUE INDEX grading_overrides_uidx ON grading_overrides (
    account_id, scope, target,
    COALESCE(stage_id,          '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(class_section_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(subject_id,        '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(term_id,           '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(item_id,           '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(exam_id,           '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX grading_overrides_lookup_idx ON grading_overrides (account_id, target);
CREATE INDEX grading_overrides_item_idx ON grading_overrides (item_id);
CREATE INDEX grading_overrides_term_idx ON grading_overrides (term_id);
CREATE INDEX grading_overrides_exam_idx ON grading_overrides (exam_id);
CREATE INDEX grading_overrides_stage_idx ON grading_overrides (stage_id);
CREATE INDEX grading_overrides_class_idx ON grading_overrides (class_section_id);
CREATE INDEX grading_overrides_subject_idx ON grading_overrides (subject_id);

-- أسبقية التجاوز: صف+مادة > صف > مادة > مرحلة > مدرسة
CREATE OR REPLACE FUNCTION resolve_weight(
    p_target override_target_enum, p_target_id UUID, p_class UUID, p_subject UUID
) RETURNS NUMERIC AS $$
    SELECT o.value
    FROM grading_overrides o
    LEFT JOIN class_sections cs ON cs.id = p_class
    WHERE o.target = p_target
      AND COALESCE(o.term_id, o.item_id, o.exam_id) = p_target_id
      AND (
           (o.scope = 'class_subject' AND o.class_section_id = p_class AND o.subject_id = p_subject)
        OR (o.scope = 'class'         AND o.class_section_id = p_class)
        OR (o.scope = 'subject'       AND o.subject_id = p_subject)
        OR (o.scope = 'stage'         AND o.stage_id = cs.stage_id)
        OR (o.scope = 'school')
      )
    ORDER BY CASE o.scope
        WHEN 'class_subject' THEN 1 WHEN 'class' THEN 2 WHEN 'subject' THEN 3
        WHEN 'stage' THEN 4 ELSE 5 END
    LIMIT 1;
$$ LANGUAGE sql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION effective_exam_weight(p_exam UUID, p_class UUID, p_subject UUID)
RETURNS NUMERIC AS $$
    SELECT COALESCE(resolve_weight('exam_weight', p_exam, p_class, p_subject), 1);
$$ LANGUAGE sql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION effective_item_weight(p_item UUID, p_class UUID, p_subject UUID)
RETURNS NUMERIC AS $$
    SELECT COALESCE(
        resolve_weight('item_weight', p_item, p_class, p_subject),
        ai.default_weight,
        100.0 / NULLIF((SELECT count(*) FROM assessment_items x WHERE x.term_id = ai.term_id), 0)
    )
    FROM assessment_items ai WHERE ai.id = p_item;
$$ LANGUAGE sql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION effective_term_weight(p_term UUID, p_class UUID, p_subject UUID)
RETURNS NUMERIC AS $$
    SELECT COALESCE(
        resolve_weight('term_weight', p_term, p_class, p_subject),
        t.default_weight,
        100.0 / NULLIF((SELECT count(*) FROM terms x
                        WHERE x.account_id = t.account_id
                          AND x.academic_year_id IS NOT DISTINCT FROM t.academic_year_id), 0)
    )
    FROM terms t WHERE t.id = p_term;
$$ LANGUAGE sql STABLE SET search_path = public;

-- ---------------------------------------------------------------------
-- 3) مجموعات النطاق والصلاحيات المقيّدة بها
--    مجموعة = أعضاء من (مراحل / صفوف / مواد). إن كان فيها أعضاء صفوف/مراحل
--    وأعضاء مواد معاً فالتغطية تتطلب الاثنين (مثلاً: قسم الرياضيات بالمرحلة
--    المتوسطة). مجموعة بلا جزء صفوف = كل الصفوف، وبلا جزء مواد = كل المواد.
-- ---------------------------------------------------------------------
CREATE TYPE scope_member_type_enum AS ENUM ('stage', 'class', 'subject');

CREATE TABLE scope_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id),
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'custom',  -- مرحلة / طابق / قسم / مخصص (نص حر للعرض)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scope_groups_account_idx ON scope_groups(account_id);

CREATE TABLE scope_group_members (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id         UUID NOT NULL REFERENCES scope_groups(id) ON DELETE CASCADE,
    member_type      scope_member_type_enum NOT NULL,
    stage_id         UUID REFERENCES stages(id) ON DELETE CASCADE,
    class_section_id UUID REFERENCES class_sections(id) ON DELETE CASCADE,
    subject_id       UUID REFERENCES subjects(id) ON DELETE CASCADE,
    CONSTRAINT scope_group_members_ck CHECK (
        (member_type = 'stage'   AND stage_id IS NOT NULL AND class_section_id IS NULL AND subject_id IS NULL) OR
        (member_type = 'class'   AND class_section_id IS NOT NULL AND stage_id IS NULL AND subject_id IS NULL) OR
        (member_type = 'subject' AND subject_id IS NOT NULL AND stage_id IS NULL AND class_section_id IS NULL)
    )
);
CREATE INDEX scope_group_members_group_idx ON scope_group_members(group_id);
CREATE INDEX scope_group_members_stage_idx ON scope_group_members(stage_id);
CREATE INDEX scope_group_members_class_idx ON scope_group_members(class_section_id);
CREATE INDEX scope_group_members_subject_idx ON scope_group_members(subject_id);

CREATE TABLE user_scoped_capabilities (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    capability_key TEXT NOT NULL REFERENCES capabilities(key) ON DELETE CASCADE,
    group_id       UUID NOT NULL REFERENCES scope_groups(id) ON DELETE CASCADE,
    granted_by     UUID REFERENCES app_users(id),
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (app_user_id, capability_key, group_id)
);
CREATE INDEX user_scoped_capabilities_user_idx ON user_scoped_capabilities(app_user_id);
CREATE INDEX user_scoped_capabilities_key_idx ON user_scoped_capabilities(capability_key);
CREATE INDEX user_scoped_capabilities_group_idx ON user_scoped_capabilities(group_id);

CREATE OR REPLACE FUNCTION group_covers(p_group UUID, p_stage UUID, p_class UUID, p_subject UUID)
RETURNS BOOLEAN AS $$
    WITH m AS (SELECT * FROM scope_group_members WHERE group_id = p_group),
    f AS (
        SELECT EXISTS (SELECT 1 FROM m WHERE member_type IN ('stage','class')) AS has_class_part,
               EXISTS (SELECT 1 FROM m WHERE member_type = 'subject')          AS has_subject_part
    )
    SELECT
        ( NOT f.has_class_part
          OR (p_class IS NOT NULL AND EXISTS (SELECT 1 FROM m WHERE member_type = 'class' AND class_section_id = p_class))
          OR (p_class IS NOT NULL AND EXISTS (SELECT 1 FROM m JOIN class_sections cs ON cs.id = p_class
                                              WHERE m.member_type = 'stage' AND m.stage_id = cs.stage_id))
          OR (p_stage IS NOT NULL AND EXISTS (SELECT 1 FROM m WHERE member_type = 'stage' AND stage_id = p_stage))
        )
        AND
        ( NOT f.has_subject_part
          OR (p_subject IS NOT NULL AND EXISTS (SELECT 1 FROM m WHERE member_type = 'subject' AND subject_id = p_subject))
        )
    FROM f;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- الصلاحية على مستوى المدرسة كاملة أو ضمن نطاق مجموعة تغطي (مرحلة/صف/مادة)
CREATE OR REPLACE FUNCTION has_capability_in(p_key TEXT, p_stage UUID, p_class UUID, p_subject UUID)
RETURNS BOOLEAN AS $$
    SELECT has_capability(p_key) OR EXISTS (
        SELECT 1
        FROM user_scoped_capabilities usc
        JOIN app_users au ON au.id = usc.app_user_id
        WHERE au.auth_uid = auth.uid()
          AND usc.capability_key = p_key
          AND group_covers(usc.group_id, p_stage, p_class, p_subject)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- مين يقدر يضيف/يعدّل تجاوز بنطاق معيّن؟ نطاق "مدرسة" لصاحب الصلاحية العامة فقط
CREATE OR REPLACE FUNCTION can_adjust_grading(p_scope override_scope_enum, p_stage UUID, p_class UUID, p_subject UUID)
RETURNS BOOLEAN AS $$
    SELECT CASE WHEN p_scope = 'school' THEN has_capability('grading.adjust')
                ELSE has_capability_in('grading.adjust', p_stage, p_class, p_subject) END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------
-- 4) الصلاحية الجديدة
-- ---------------------------------------------------------------------
INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'grading.adjust', 'تعديل نسب وأوزان المعدلات وعدد البنود ضمن نطاقه', 'Admin', id, 'modify'
FROM permission_resources WHERE code = 'grades'
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_scoped_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY academic_years_select ON academic_years FOR SELECT USING (account_id = current_account_id());
CREATE POLICY academic_years_insert ON academic_years FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY academic_years_update ON academic_years FOR UPDATE USING (account_id = current_account_id() AND has_capability('config.manage')) WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY academic_years_delete ON academic_years FOR DELETE USING (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY assessment_items_select ON assessment_items FOR SELECT USING (account_id = current_account_id());
CREATE POLICY assessment_items_insert ON assessment_items FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY assessment_items_update ON assessment_items FOR UPDATE USING (account_id = current_account_id() AND has_capability('config.manage')) WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));
CREATE POLICY assessment_items_delete ON assessment_items FOR DELETE USING (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY grading_overrides_select ON grading_overrides FOR SELECT USING (account_id = current_account_id());
CREATE POLICY grading_overrides_insert ON grading_overrides FOR INSERT WITH CHECK (
    account_id = current_account_id() AND can_adjust_grading(scope, stage_id, class_section_id, subject_id));
CREATE POLICY grading_overrides_update ON grading_overrides FOR UPDATE USING (
    account_id = current_account_id() AND can_adjust_grading(scope, stage_id, class_section_id, subject_id))
    WITH CHECK (account_id = current_account_id() AND can_adjust_grading(scope, stage_id, class_section_id, subject_id));
CREATE POLICY grading_overrides_delete ON grading_overrides FOR DELETE USING (
    account_id = current_account_id() AND can_adjust_grading(scope, stage_id, class_section_id, subject_id));

CREATE POLICY scope_groups_select ON scope_groups FOR SELECT USING (account_id = current_account_id());
CREATE POLICY scope_groups_insert ON scope_groups FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('users.manage'));
CREATE POLICY scope_groups_update ON scope_groups FOR UPDATE USING (account_id = current_account_id() AND has_capability('users.manage')) WITH CHECK (account_id = current_account_id() AND has_capability('users.manage'));
CREATE POLICY scope_groups_delete ON scope_groups FOR DELETE USING (account_id = current_account_id() AND has_capability('users.manage'));

CREATE POLICY scope_group_members_select ON scope_group_members FOR SELECT USING (
    group_id IN (SELECT id FROM scope_groups WHERE account_id = current_account_id()));
CREATE POLICY scope_group_members_insert ON scope_group_members FOR INSERT WITH CHECK (
    has_capability('users.manage') AND group_id IN (SELECT id FROM scope_groups WHERE account_id = current_account_id()));
CREATE POLICY scope_group_members_delete ON scope_group_members FOR DELETE USING (
    has_capability('users.manage') AND group_id IN (SELECT id FROM scope_groups WHERE account_id = current_account_id()));

CREATE POLICY user_scoped_capabilities_select ON user_scoped_capabilities FOR SELECT USING (
    app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id()));
CREATE POLICY user_scoped_capabilities_insert ON user_scoped_capabilities FOR INSERT WITH CHECK (
    has_capability('users.manage')
    AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id())
    AND group_id IN (SELECT id FROM scope_groups WHERE account_id = current_account_id()));
CREATE POLICY user_scoped_capabilities_delete ON user_scoped_capabilities FOR DELETE USING (
    has_capability('users.manage')
    AND app_user_id IN (SELECT id FROM app_users WHERE account_id = current_account_id()));
-- =====================================================================
