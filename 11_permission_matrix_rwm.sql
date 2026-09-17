-- =====================================================================
-- 11_permission_matrix_rwm.sql
-- تنظيم الصلاحيات على مستوى مورد × إجراء (read/write/modify)
-- + قوالب أدوار جاهزة (الأدوار الخمسة المتفق عليها) + إمكانية إنشاء
-- موارد وأدوار جديدة بالكامل من لوحة التحكم بدون أي كود إضافي
--
-- مبدأ "الأحجية": هاد الملف إضافي بالكامل فوق 04-10 - لا يعيد تعريف أي
-- دالة موجودة (has_capability, enforce_grades_admin_lock, إلخ)، فقط
-- يوسّع كتالوج capabilities الموجود أصلاً بأعمدة تصنيف اختيارية
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الموارد (Resources) - كتالوج ديناميكي، المدرسة تقدر تضيف مورد جديد
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 2) توسيع جدول capabilities الموجود (04) بتصنيف مورد/إجراء - بدون
--    حذف أو تعديل أي عمود قديم، ولا أي صف قديم يُحذف
-- ---------------------------------------------------------------------
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES permission_resources(id);
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS action capability_action_enum;
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS is_workflow_gate BOOLEAN NOT NULL DEFAULT false;
-- is_workflow_gate = true تعني: صلاحية خاصة بمرحلة عمل معيّنة (متل قفل الاعتماد
-- المتدرّج بملف 10) وليست جزء من مصفوفة read/write/modify الأساسية

-- ---------------------------------------------------------------------
-- 3) زرع الموارد النظامية التسعة المستخدمة عبر الملفات 01-10
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 4) ربط الصلاحيات القديمة (من 04-10) بتصنيفها الجديد - بدون تغيير
--    أكوادها النصية (grades.enter تبقى grades.enter) حتى تستمر كل
--    الدوال القديمة (has_capability بالكود النصي) تشتغل بدون أي تعديل
-- ---------------------------------------------------------------------
UPDATE capabilities c SET resource_id = r.id, action = 'write'
FROM permission_resources r WHERE r.code = 'grades' AND c.code = 'grades.enter';

UPDATE capabilities c SET resource_id = r.id, action = 'read'
FROM permission_resources r WHERE r.code = 'grades' AND c.code = 'grades.view_all';

UPDATE capabilities c SET resource_id = r.id, action = 'modify', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.code = 'grades.enter_privileged';

UPDATE capabilities c SET resource_id = r.id, action = 'modify', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.code = 'grades.finalize_submission';

UPDATE capabilities c SET resource_id = r.id, action = 'write', is_workflow_gate = true
FROM permission_resources r WHERE r.code = 'grades' AND c.code = 'grades.enter_multi_component';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'roster' AND c.code = 'roster.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'read'
FROM permission_resources r WHERE r.code = 'reports' AND c.code IN ('reports.view', 'reports.export');

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'config' AND c.code = 'config.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'users' AND c.code = 'users.manage';

UPDATE capabilities c SET resource_id = r.id, action = 'write'
FROM permission_resources r WHERE r.code = 'notifications' AND c.code = 'notifications.send';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'imports' AND c.code = 'records.import_manage';

UPDATE capabilities c SET resource_id = r.id, action = 'modify'
FROM permission_resources r WHERE r.code = 'window' AND c.code = 'window.toggle';

-- تعبئة أي فجوات بمصفوفة read/write/modify ما كانت موجودة قبل (مثال:
-- ما كان في "roster.view" منفصلة عن roster.manage) - إضافات جديدة فقط
INSERT INTO capabilities (code, description, resource_id, action)
SELECT 'roster.view', 'الاطلاع على قوائم الطلاب والصفوف دون تعديل', id, 'read' FROM permission_resources WHERE code = 'roster'
ON CONFLICT (code) DO NOTHING;

INSERT INTO capabilities (code, description, resource_id, action)
SELECT 'exams.view', 'الاطلاع على تعريف الامتحانات دون تعديل', id, 'read' FROM permission_resources WHERE code = 'exams'
ON CONFLICT (code) DO NOTHING;

INSERT INTO capabilities (code, description, resource_id, action)
SELECT 'exams.manage', 'إنشاء/تعديل الامتحانات وأنواعها', id, 'modify' FROM permission_resources WHERE code = 'exams'
ON CONFLICT (code) DO NOTHING;

INSERT INTO capabilities (code, description, resource_id, action)
SELECT 'imports.write', 'رفع ملف استيراد جديد (بدون صلاحية اعتماده نهائياً)', id, 'write' FROM permission_resources WHERE code = 'imports'
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5) دالة إنشاء مورد جديد بالكامل - تولّد صلاحياته الثلاثة تلقائياً
--    (هاد هو المطلوب "إنشاء صلاحيات جديدة لأدوار جديدة" بدون أي كود)
-- ---------------------------------------------------------------------
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
    IF NOT has_capability(p_actor_id, 'config.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية إدارة الإعدادات (config.manage) اللازمة لإنشاء مورد صلاحيات جديد';
    END IF;

    INSERT INTO permission_resources (account_id, code, label_ar, is_system)
    VALUES (p_account_id, p_code, p_label_ar, false)
    RETURNING id INTO v_resource_id;

    INSERT INTO capabilities (code, description, resource_id, action) VALUES
        (p_code || '.read',   'الاطلاع على ' || p_label_ar, v_resource_id, 'read'),
        (p_code || '.write',  'إضافة جديد ضمن ' || p_label_ar, v_resource_id, 'write'),
        (p_code || '.modify', 'تعديل/حذف ضمن ' || p_label_ar, v_resource_id, 'modify');

    INSERT INTO audit_logs (user_id, action_type, old_value, new_value)
    VALUES (p_actor_id, 'permission_resource_created', NULL,
            jsonb_build_object('resource_code', p_code, 'account_id', p_account_id)::text);

    RETURN v_resource_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 6) قوالب الأدوار (Role Templates) - كل دور من الخمسة المتفق عليهم
--    قالب جاهز، وقابل إنشاء قوالب جديدة كاملة لأدوار غير موجودة أصلاً
-- ---------------------------------------------------------------------
CREATE TABLE role_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID REFERENCES accounts(id), -- NULL = قالب نظامي متاح لكل الحسابات
    code        TEXT NOT NULL,
    label_ar    TEXT NOT NULL,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, code)
);

CREATE TABLE role_template_capabilities (
    template_id     UUID NOT NULL REFERENCES role_templates(id) ON DELETE CASCADE,
    capability_id   UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, capability_id)
);

-- الأدوار النظامية الخمسة (نفس المتفق عليه من بداية المشروع)
INSERT INTO role_templates (code, label_ar, is_system) VALUES
    ('solo_teacher',    'معلّم مستقل (كامل الصلاحيات ضمن حدوده)', true),
    ('school_admin',    'الناظر العام',                            true),
    ('assistant_admin', 'مساعد الناظر العام',                      true),
    ('subject_teacher', 'معلم المادة',                              true),
    ('read_only_role',  'دور اطلاع فقط (مثل رئيس قسم)',            true)
ON CONFLICT (account_id, code) WHERE account_id IS NULL DO NOTHING;

-- ---------------------------------------------------------------------
-- 7) ربط الصلاحيات الافتراضية بكل قالب نظامي - نقطة بداية معقولة،
--    قابلة للتعديل لاحقاً فردياً لكل حساب دون التأثير على القالب النظامي
-- ---------------------------------------------------------------------
INSERT INTO role_template_capabilities (template_id, capability_id)
SELECT t.id, c.id FROM role_templates t, capabilities c
WHERE t.code = 'solo_teacher'
  AND c.code IN ('grades.enter','grades.view_all','grades.enter_privileged','grades.finalize_submission',
                 'grades.enter_multi_component','roster.manage','roster.view','exams.manage','exams.view',
                 'reports.view','reports.export','config.manage','users.manage','notifications.send',
                 'records.import_manage','imports.write','window.toggle')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_id)
SELECT t.id, c.id FROM role_templates t, capabilities c
WHERE t.code = 'school_admin'
  AND c.code IN ('grades.view_all','grades.finalize_submission','roster.manage','roster.view','exams.manage',
                 'exams.view','reports.view','reports.export','config.manage','users.manage',
                 'notifications.send','records.import_manage','imports.write','window.toggle')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_id)
SELECT t.id, c.id FROM role_templates t, capabilities c
WHERE t.code = 'assistant_admin'
  AND c.code IN ('grades.enter','grades.view_all','grades.enter_privileged','roster.manage','roster.view',
                 'exams.view','reports.view','reports.export','notifications.send','imports.write')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_id)
SELECT t.id, c.id FROM role_templates t, capabilities c
WHERE t.code = 'subject_teacher'
  AND c.code IN ('grades.enter','grades.enter_multi_component','roster.view','exams.view','reports.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_template_capabilities (template_id, capability_id)
SELECT t.id, c.id FROM role_templates t, capabilities c
WHERE t.code = 'read_only_role'
  AND c.code IN ('grades.view_all','roster.view','exams.view','reports.view')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 8) دوال إدارة المصفوفة - نقطة استدعاء واحدة لكل خانة بالجدول التفاعلي
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_role_template(
    p_account_id UUID, p_code TEXT, p_label_ar TEXT, p_actor_id UUID
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    IF NOT has_capability(p_actor_id, 'users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لإنشاء دور جديد';
    END IF;

    INSERT INTO role_templates (account_id, code, label_ar, is_system)
    VALUES (p_account_id, p_code, p_label_ar, false) RETURNING id INTO v_id;

    INSERT INTO audit_logs (user_id, action_type, old_value, new_value)
    VALUES (p_actor_id, 'role_template_created', NULL,
            jsonb_build_object('template_code', p_code, 'account_id', p_account_id)::text);

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION toggle_role_template_capability(
    p_template_id UUID, p_capability_id UUID, p_grant BOOLEAN, p_actor_id UUID
) RETURNS TEXT AS $$
BEGIN
    IF NOT has_capability(p_actor_id, 'users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لتعديل مصفوفة الأدوار';
    END IF;

    IF p_grant THEN
        INSERT INTO role_template_capabilities (template_id, capability_id)
        VALUES (p_template_id, p_capability_id) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM role_template_capabilities
        WHERE template_id = p_template_id AND capability_id = p_capability_id;
    END IF;

    INSERT INTO audit_logs (user_id, action_type, old_value, new_value)
    VALUES (p_actor_id, 'role_template_capability_toggled', NULL,
            jsonb_build_object('template_id', p_template_id, 'capability_id', p_capability_id, 'granted', p_grant)::text);

    RETURN 'تم التحديث';
END;
$$ LANGUAGE plpgsql;

-- تطبيق قالب دور على مستخدم معيّن - يضيف الصلاحيات الناقصة فقط، ولا يلغي
-- أي صلاحية فردية إضافية سبق ومُنحت للمستخدم خارج القالب (عزل تام بين الاثنين)
CREATE OR REPLACE FUNCTION apply_role_template_to_user(
    p_user_id UUID, p_template_id UUID, p_actor_id UUID
) RETURNS TEXT AS $$
BEGIN
    IF NOT has_capability(p_actor_id, 'users.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية users.manage اللازمة لتطبيق دور على مستخدم';
    END IF;

    INSERT INTO user_capabilities (user_id, capability_id)
    SELECT p_user_id, rtc.capability_id
    FROM role_template_capabilities rtc
    WHERE rtc.template_id = p_template_id
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_logs (user_id, action_type, old_value, new_value)
    VALUES (p_actor_id, 'role_template_applied', NULL,
            jsonb_build_object('target_user', p_user_id, 'template_id', p_template_id)::text);

    RETURN 'تم منح المستخدم كل صلاحيات القالب';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 9) RLS على الجداول الجديدة (نفس نمط 06 - عزل حسابي، مع استثناء
--    الموارد/القوالب النظامية account_id IS NULL يلي تظهر للكل للقراءة)
-- ---------------------------------------------------------------------
ALTER TABLE permission_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_template_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY permission_resources_visibility ON permission_resources
    USING (account_id IS NULL OR account_id = current_account_id());

CREATE POLICY role_templates_visibility ON role_templates
    USING (account_id IS NULL OR account_id = current_account_id());

CREATE POLICY role_template_capabilities_visibility ON role_template_capabilities
    USING (template_id IN (
        SELECT id FROM role_templates WHERE account_id IS NULL OR account_id = current_account_id()
    ));
-- =====================================================================
