-- =====================================================================
-- 11_permission_matrix_rwm.sql
-- تنظيم الصلاحيات على مستوى مورد × إجراء (read/write/modify)
-- + قوالب أدوار جاهزة (الأدوار الخمسة المتفق عليها) + إمكانية إنشاء
-- موارد وأدوار جديدة بالكامل من لوحة التحكم بدون أي كود إضافي
--
-- ملاحظة مهمة: هاد الملف يطابق السكيما الحقيقية الموجودة على المشروع -
-- capabilities مفتاحها الأساسي key (نصي)، وليس id/code كما كان مفترضاً
-- بمسودة أولى. has_capability(p_code TEXT) توخذ وسيط واحد وتتحقق من
-- auth.uid() الجلسة الحالية مباشرة (مش actor_id مُمرَّر).
-- =====================================================================

CREATE TABLE permission_resources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID REFERENCES accounts(id), -- NULL = مورد نظامي عام لكل الحسابات
    code        TEXT NOT NULL,
    label_ar    TEXT NOT NULL,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, code)
);

CREATE TYPE capability_action_enum AS ENUM ('read', 'write', 'modify');

-- توسيع جدول capabilities الموجود بتصنيف مورد/إجراء - بدون حذف أو تعديل
-- أي عمود قديم، ولا أي صف قديم يُحذف
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES permission_resources(id);
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS action capability_action_enum;
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS is_workflow_gate BOOLEAN NOT NULL DEFAULT false;

INSERT INTO permission_resources (code, label_ar, is_system) VALUES
    ('grades',        'العلامات',                true),
    ('roster',        'قوائم الطلاب والصفوف',    true),
    ('exams',         'الامتحانات وأنواعها',     true),
    ('reports',       'التقارير',                 true),
    ('config',        'إعدادات المدرسة',         true),
    ('users',         'المستخدمين والأدوار',     true),
    ('notifications', 'إشعارات الأهالي',         true),
    ('imports',       'الاستيراد الجماعي',       true),
    ('window',        'نافذة العلامات',           true)
ON CONFLICT (account_id, code) WHERE account_id IS NULL DO NOTHING;

-- ربط الصلاحيات القديمة بتصنيفها الجديد - بدون تغيير أكوادها (c.key يبقى
-- كما هو حتى تستمر كل الدوال القديمة تعمل بدون أي تعديل)
UPDATE capabilities c SET resource_id = r.id, action = 'write'
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.enter';

UPDATE capabilities c SET resource_id = r.id, action = 'read'
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.view_all';

UPDATE capabilities c SET resource_id = r.id, action = 'modify', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.finalize_submission';

UPDATE capabilities c SET resource_id = r.id, action = 'write', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.enter_privileged';

UPDATE capabilities c SET resource_id = r.id, action = 'write', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.enter_multi_component';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'grades' AND c.key = 'grades.edit_others';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'roster' AND c.key = 'roster.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'read'
FROM permission_resources r WHERE r.code = 'reports' AND c.key IN ('reports.view', 'reports.export');

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'config' AND c.key = 'config.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'users' AND c.key = 'users.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'write'
FROM permission_resources r WHERE r.code = 'notifications' AND c.key = 'notifications.send';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'imports' AND c.key = 'records.import_manage';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'window' AND c.key = 'window.toggle';

-- تعبئة أي فجوات بمصفوفة read/write/modify ما كانت موجودة قبل
INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'roster.view', 'الاطلاع على قوائم الطلاب والصفوف دون تعديل', 'Roster', id, 'read' FROM permission_resources WHERE code = 'roster'
ON CONFLICT (key) DO NOTHING;

INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'exams.view', 'الاطلاع على تعريف الامتحانات دون تعديل', 'Admin', id, 'read' FROM permission_resources WHERE code = 'exams'
ON CONFLICT (key) DO NOTHING;

INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'exams.manage', 'إنشاء/تعديل الامتحانات وأنواعها', 'Admin', id, 'modify' FROM permission_resources WHERE code = 'exams'
ON CONFLICT (key) DO NOTHING;

INSERT INTO capabilities (key, label_ar, category, resource_id, action)
SELECT 'imports.write', 'رفع ملف استيراد جديد (بدون صلاحية اعتماده نهائياً)', 'Admin', id, 'write' FROM permission_resources WHERE code = 'imports'
ON CONFLICT (key) DO NOTHING;

-- دالة إنشاء مورد جديد بالكامل - تولّد صلاحياته الثلاثة تلقائياً
CREATE OR REPLACE FUNCTION create_permission_resource(
    p_account_id UUID,
    p_code TEXT,
    p_label_ar TEXT,
    p_actor_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_resource_id UUID;
BEGIN
    IF NOT has_capability('config.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية إدارة الإعدادات (config.manage) اللازمة لإنشاء مورد صلاحيات جديد';
    END IF;

    IF p_account_id IS NULL THEN
        RAISE EXCEPTION 'p_account_id إلزامي - لا يمكن إنشاء مورد صلاحيات بدون حساب محدد (NULL يعني مورد نظامي ظاهر لكل الحسابات)';
    END IF;

    INSERT INTO permission_resources (account_id, code, label_ar, is_system)
    VALUES (p_account_id, p_code, p_label_ar, false)
    RETURNING id INTO v_resource_id;

    INSERT INTO capabilities (key, label_ar, category, resource_id, action) VALUES
        (p_code || '.read',   'الاطلاع على ' || p_label_ar, p_label_ar, v_resource_id, 'read'),
        (p_code || '.write',  'إضافة جديد ضمن ' || p_label_ar, p_label_ar, v_resource_id, 'write'),
        (p_code || '.modify', 'تعديل/حذف ضمن ' || p_label_ar, p_label_ar, v_resource_id, 'modify');

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (p_account_id, p_actor_id, 'insert', 'permission_resources',
            jsonb_build_object('event', 'permission_resource_created', 'resource_code', p_code));

    RETURN v_resource_id;
END;
$$ LANGUAGE plpgsql;

-- قوالب الأدوار (Role Templates) - كل دور من الخمسة المتفق عليهم قالب
-- جاهز، وقابل إنشاء قوالب جديدة كاملة لأدوار غير موجودة أصلاً
CREATE TABLE role_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID REFERENCES accounts(id), -- NULL = قالب نظامي متاح لكل الحسابات
    code        TEXT NOT NULL,
    label_ar    TEXT NOT NULL,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, code)
);

-- الربط بـ capability_key (نصي) وليس capability_id - لأن capabilities
-- مفتاحها الأساسي key، لا يوجد عمود id على هذا الجدول
CREATE TABLE role_template_capabilities (
    template_id     UUID NOT NULL REFERENCES role_templates(id) ON DELETE CASCADE,
    capability_key  TEXT NOT NULL REFERENCES capabilities(key) ON DELETE CASCADE,
    PRIMARY KEY (template_id, capability_key)
);

INSERT INTO role_templates (code, label_ar, is_system) VALUES
    ('solo_teacher',    'معلّم مستقل (كامل الصلاحيات ضمن حدوده)', true),
    ('school_admin',    'الناظر العام',                            true),
    ('assistant_admin', 'مساعد الناظر العام',                      true),
    ('subject_teacher', 'معلم المادة',                              true),
    ('read_only_role',  'دور اطلاع فقط (مثل رئيس قسم)',            true)
ON CONFLICT (account_id, code) WHERE account_id IS NULL DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_key)
SELECT t.id, c.key FROM role_templates t, capabilities c
WHERE t.code = 'solo_teacher'
  AND c.key IN ('grades.enter','grades.view_all','grades.enter_privileged','grades.finalize_submission',
                 'grades.enter_multi_component','roster.manage','roster.view','exams.manage','exams.view',
                 'reports.view','reports.export','config.manage','users.manage','notifications.send',
                 'records.import_manage','imports.write','window.toggle')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_key)
SELECT t.id, c.key FROM role_templates t, capabilities c
WHERE t.code = 'school_admin'
  AND c.key IN ('grades.view_all','grades.finalize_submission','roster.manage','roster.view','exams.manage',
                 'exams.view','reports.view','reports.export','config.manage','users.manage',
                 'notifications.send','records.import_manage','imports.write','window.toggle')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_key)
SELECT t.id, c.key FROM role_templates t, capabilities c
WHERE t.code = 'assistant_admin'
  AND c.key IN ('grades.enter','grades.view_all','grades.enter_privileged','roster.manage','roster.view',
                 'exams.view','reports.view','reports.export','notifications.send','imports.write')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_key)
SELECT t.id, c.key FROM role_templates t, capabilities c
WHERE t.code = 'subject_teacher'
  AND c.key IN ('grades.enter','grades.enter_multi_component','roster.view','exams.view','reports.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_key)
SELECT t.id, c.key FROM role_templates t, capabilities c
WHERE t.code = 'read_only_role'
  AND c.key IN ('grades.view_all','roster.view','exams.view','reports.view')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION create_role_template(
    p_account_id UUID, p_code TEXT, p_label_ar TEXT, p_actor_id UUID
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    IF NOT has_capability('users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لإنشاء دور جديد';
    END IF;

    IF p_account_id IS NULL THEN
        RAISE EXCEPTION 'p_account_id إلزامي - لا يمكن إنشاء دور بدون حساب محدد (NULL يعني قالب نظامي ظاهر لكل الحسابات)';
    END IF;

    INSERT INTO role_templates (account_id, code, label_ar, is_system)
    VALUES (p_account_id, p_code, p_label_ar, false) RETURNING id INTO v_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (p_account_id, p_actor_id, 'insert', 'role_templates',
            jsonb_build_object('event', 'role_template_created', 'template_code', p_code));

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION toggle_role_template_capability(
    p_template_id UUID, p_capability_key TEXT, p_grant BOOLEAN, p_actor_id UUID
) RETURNS TEXT AS $$
DECLARE v_account_id UUID;
BEGIN
    IF NOT has_capability('users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لتعديل مصفوفة الأدوار';
    END IF;

    SELECT account_id INTO v_account_id FROM app_users WHERE id = p_actor_id;

    IF p_grant THEN
        INSERT INTO role_template_capabilities (template_id, capability_key)
        VALUES (p_template_id, p_capability_key) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM role_template_capabilities
        WHERE template_id = p_template_id AND capability_key = p_capability_key;
    END IF;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'role_template_capabilities',
            jsonb_build_object('template_id', p_template_id, 'capability_key', p_capability_key, 'granted', p_grant));

    RETURN 'تم التحديث';
END;
$$ LANGUAGE plpgsql;

-- تطبيق قالب دور على مستخدم معيّن - يضيف الصلاحيات الناقصة فقط، ولا يلغي
-- أي صلاحية فردية إضافية سبق ومُنحت للمستخدم خارج القالب
CREATE OR REPLACE FUNCTION apply_role_template_to_user(
    p_user_id UUID, p_template_id UUID, p_actor_id UUID
) RETURNS TEXT AS $$
DECLARE v_account_id UUID;
BEGIN
    IF NOT has_capability('users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لتطبيق دور على مستخدم';
    END IF;

    SELECT account_id INTO v_account_id FROM app_users WHERE id = p_user_id;

    INSERT INTO user_capabilities (app_user_id, capability_key)
    SELECT p_user_id, rtc.capability_key
    FROM role_template_capabilities rtc
    WHERE rtc.template_id = p_template_id
    ON CONFLICT (app_user_id, capability_key) DO NOTHING;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'update', 'user_capabilities',
            jsonb_build_object('event', 'role_template_applied', 'target_user', p_user_id, 'template_id', p_template_id));

    RETURN 'تم منح المستخدم كل صلاحيات القالب';
END;
$$ LANGUAGE plpgsql;

-- RLS على الجداول الجديدة - القراءة مفتوحة لكل عضو بالحساب (بما فيها
-- الصفوف النظامية)، الكتابة محصورة بصفوف حساب المستخدم نفسه + نفس
-- الصلاحية يلي تتحقق منها الدوال أعلاه (config.manage/users.manage) -
-- بدون هالشرط، أي مستخدم بالحساب كان يقدر يكتب مباشرة عبر Supabase
-- client من غير ما يمر على create_permission_resource/create_role_template
ALTER TABLE permission_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_template_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY permission_resources_select ON permission_resources
    FOR SELECT USING (account_id IS NULL OR account_id = current_account_id());

CREATE POLICY permission_resources_insert ON permission_resources
    FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY permission_resources_update ON permission_resources
    FOR UPDATE USING (account_id = current_account_id())
    WITH CHECK (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY permission_resources_delete ON permission_resources
    FOR DELETE USING (account_id = current_account_id() AND has_capability('config.manage'));

CREATE POLICY role_templates_select ON role_templates
    FOR SELECT USING (account_id IS NULL OR account_id = current_account_id());

CREATE POLICY role_templates_insert ON role_templates
    FOR INSERT WITH CHECK (account_id = current_account_id() AND has_capability('users.manage'));

CREATE POLICY role_templates_update ON role_templates
    FOR UPDATE USING (account_id = current_account_id())
    WITH CHECK (account_id = current_account_id() AND has_capability('users.manage'));

CREATE POLICY role_templates_delete ON role_templates
    FOR DELETE USING (account_id = current_account_id() AND has_capability('users.manage'));

CREATE POLICY role_template_capabilities_select ON role_template_capabilities
    FOR SELECT USING (template_id IN (
        SELECT id FROM role_templates WHERE account_id IS NULL OR account_id = current_account_id()
    ));

CREATE POLICY role_template_capabilities_insert ON role_template_capabilities
    FOR INSERT WITH CHECK (
        has_capability('users.manage')
        AND template_id IN (SELECT id FROM role_templates WHERE account_id = current_account_id())
    );

CREATE POLICY role_template_capabilities_delete ON role_template_capabilities
    FOR DELETE USING (
        has_capability('users.manage')
        AND template_id IN (SELECT id FROM role_templates WHERE account_id = current_account_id())
    );
-- =====================================================================
