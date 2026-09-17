-- =====================================================================
-- 07_bulk_import.sql
-- آلية استيراد جماعي (Bulk Import) للطلاب / المعلمين / الصفوف
-- مع كشف التصادم، شاشة مراجعة قبل الاعتماد، وأرشفة المسميات القديمة
--
-- مصحَّح ليطابق السكيما الحقيقية: capabilities مفتاحها key نصي وليس
-- id/code، has_capability() توخذ وسيط واحد (اسم الصلاحية) وتتحقق من
-- auth.uid() الجلسة الحالية مباشرة، و audit_logs تتطلب account_id +
-- action_type من ENUM محدود (insert/update/delete/login/grade_window_toggle)
-- + عمودي old/new_value من نوع JSONB وليس TEXT.
-- =====================================================================

-- دالة مساعدة إضافية (لا تحل محل current_app_user() الموجودة أصلاً،
-- بترجع الـ id فقط للراحة ببقية ملفات 07-11)
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID AS $$
    SELECT id FROM app_users WHERE auth_uid = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

INSERT INTO capabilities (key, label_ar, category)
VALUES ('records.import_manage', 'استيراد ومراجعة واعتماد ملفات الطلاب/المعلمين/الصفوف الجماعية', 'Admin')
ON CONFLICT (key) DO NOTHING;

CREATE TYPE import_entity_enum AS ENUM ('student', 'teacher', 'class');
CREATE TYPE import_batch_status_enum AS ENUM ('pending_review', 'committed', 'cancelled');
CREATE TYPE import_row_match_enum AS ENUM ('new', 'identical', 'conflict');
CREATE TYPE import_row_action_enum AS ENUM ('pending', 'accept_new', 'keep_old', 'manual_edit', 'ignore');

CREATE TABLE import_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    entity_type     import_entity_enum NOT NULL,
    file_name       TEXT,
    uploaded_by     UUID NOT NULL REFERENCES app_users(id),
    status          import_batch_status_enum NOT NULL DEFAULT 'pending_review',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at    TIMESTAMPTZ
);

CREATE TABLE import_staging_students (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    raw_full_name       TEXT NOT NULL,
    raw_class_section_id UUID REFERENCES class_sections(id),
    raw_extra           JSONB DEFAULT '{}'::jsonb,
    match_status        import_row_match_enum NOT NULL DEFAULT 'new',
    matched_student_id  UUID REFERENCES students(id),
    similarity_score    NUMERIC(4,3),
    resolved_action     import_row_action_enum NOT NULL DEFAULT 'pending',
    resolved_final_name TEXT,
    resolved_by         UUID REFERENCES app_users(id),
    resolved_at         TIMESTAMPTZ
);

CREATE TABLE import_staging_teachers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    raw_full_name       TEXT NOT NULL,
    raw_email           TEXT,
    raw_phone           TEXT,
    match_status        import_row_match_enum NOT NULL DEFAULT 'new',
    matched_user_id     UUID REFERENCES app_users(id),
    similarity_score    NUMERIC(4,3),
    resolved_action     import_row_action_enum NOT NULL DEFAULT 'pending',
    resolved_final_name TEXT,
    resolved_final_email TEXT,
    resolved_final_phone TEXT,
    resolved_by         UUID REFERENCES app_users(id),
    resolved_at         TIMESTAMPTZ
);

CREATE TABLE import_staging_classes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    raw_school_id       UUID REFERENCES schools(id),
    raw_grade_level     TEXT NOT NULL,
    raw_section_label   TEXT NOT NULL,
    match_status        import_row_match_enum NOT NULL DEFAULT 'new',
    matched_class_id    UUID REFERENCES class_sections(id),
    resolved_action     import_row_action_enum NOT NULL DEFAULT 'pending',
    resolved_by         UUID REFERENCES app_users(id),
    resolved_at         TIMESTAMPTZ
);

CREATE TABLE name_change_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts(id),
    entity_type         import_entity_enum NOT NULL,
    entity_id           UUID NOT NULL,
    field_name          TEXT NOT NULL,
    old_value           TEXT,
    new_value           TEXT,
    changed_by          UUID NOT NULL REFERENCES app_users(id),
    batch_id            UUID REFERENCES import_batches(id),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    review_window_ends  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '60 days')
);

CREATE OR REPLACE FUNCTION analyze_student_import_batch(p_batch_id UUID)
RETURNS VOID AS $$
DECLARE
    v_row RECORD;
    v_best_match RECORD;
BEGIN
    FOR v_row IN
        SELECT * FROM import_staging_students WHERE batch_id = p_batch_id
    LOOP
        SELECT s.id, s.full_name,
               similarity(lower(trim(s.full_name)), lower(trim(v_row.raw_full_name))) AS sim
        INTO v_best_match
        FROM students s
        JOIN class_enrollments ce ON ce.student_id = s.id AND ce.class_section_id = v_row.raw_class_section_id
        ORDER BY sim DESC
        LIMIT 1;

        IF v_best_match.id IS NULL THEN
            UPDATE import_staging_students SET match_status = 'new' WHERE id = v_row.id;
        ELSIF v_best_match.sim >= 0.999 THEN
            UPDATE import_staging_students
            SET match_status = 'identical', matched_student_id = v_best_match.id, similarity_score = v_best_match.sim
            WHERE id = v_row.id;
        ELSIF v_best_match.sim >= 0.55 THEN
            UPDATE import_staging_students
            SET match_status = 'conflict', matched_student_id = v_best_match.id, similarity_score = v_best_match.sim
            WHERE id = v_row.id;
        ELSE
            UPDATE import_staging_students SET match_status = 'new' WHERE id = v_row.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analyze_teacher_import_batch(p_batch_id UUID)
RETURNS VOID AS $$
DECLARE
    v_row RECORD;
    v_matched_id UUID;
    v_matched_name TEXT;
BEGIN
    FOR v_row IN
        SELECT * FROM import_staging_teachers WHERE batch_id = p_batch_id
    LOOP
        SELECT au.id, au.full_name INTO v_matched_id, v_matched_name
        FROM app_users au
        WHERE (v_row.raw_email IS NOT NULL AND lower(au.email) = lower(v_row.raw_email))
           OR (v_row.raw_phone IS NOT NULL AND au.phone = v_row.raw_phone)
        LIMIT 1;

        IF v_matched_id IS NULL THEN
            UPDATE import_staging_teachers SET match_status = 'new' WHERE id = v_row.id;
        ELSIF v_matched_name = v_row.raw_full_name THEN
            UPDATE import_staging_teachers SET match_status = 'identical', matched_user_id = v_matched_id WHERE id = v_row.id;
        ELSE
            UPDATE import_staging_teachers SET match_status = 'conflict', matched_user_id = v_matched_id WHERE id = v_row.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_batch_fully_resolved(p_batch_id UUID, p_entity import_entity_enum)
RETURNS BOOLEAN AS $$
DECLARE
    v_pending_count INTEGER;
BEGIN
    IF p_entity = 'student' THEN
        SELECT count(*) INTO v_pending_count FROM import_staging_students
        WHERE batch_id = p_batch_id AND match_status = 'conflict' AND resolved_action = 'pending';
    ELSIF p_entity = 'teacher' THEN
        SELECT count(*) INTO v_pending_count FROM import_staging_teachers
        WHERE batch_id = p_batch_id AND match_status = 'conflict' AND resolved_action = 'pending';
    ELSE
        SELECT count(*) INTO v_pending_count FROM import_staging_classes
        WHERE batch_id = p_batch_id AND match_status = 'conflict' AND resolved_action = 'pending';
    END IF;

    RETURN v_pending_count = 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commit_student_import_batch(p_batch_id UUID, p_actor_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_row RECORD;
    v_account_id UUID;
BEGIN
    IF NOT enforce_batch_fully_resolved(p_batch_id, 'student') THEN
        RAISE EXCEPTION 'لا يمكن الاعتماد: ما زال هناك أسطر متصادمة بدون قرار مراجع بشري';
    END IF;

    SELECT account_id INTO v_account_id FROM import_batches WHERE id = p_batch_id;

    FOR v_row IN
        SELECT * FROM import_staging_students WHERE batch_id = p_batch_id
    LOOP
        IF v_row.resolved_action = 'ignore' OR
           (v_row.match_status = 'identical' AND v_row.resolved_action = 'pending') THEN
            CONTINUE;
        END IF;

        IF v_row.match_status = 'new' OR v_row.resolved_action = 'accept_new' AND v_row.matched_student_id IS NULL THEN
            INSERT INTO students (id, account_id, full_name)
            VALUES (gen_random_uuid(), v_account_id, COALESCE(v_row.resolved_final_name, v_row.raw_full_name));

        ELSIF v_row.resolved_action IN ('accept_new', 'manual_edit') AND v_row.matched_student_id IS NOT NULL THEN
            INSERT INTO name_change_log (account_id, entity_type, entity_id, field_name, old_value, new_value, changed_by, batch_id)
            SELECT v_account_id, 'student', s.id, 'full_name', s.full_name,
                   COALESCE(v_row.resolved_final_name, v_row.raw_full_name), p_actor_id, p_batch_id
            FROM students s WHERE s.id = v_row.matched_student_id;

            UPDATE students SET full_name = COALESCE(v_row.resolved_final_name, v_row.raw_full_name)
            WHERE id = v_row.matched_student_id;
        END IF;
    END LOOP;

    UPDATE import_batches SET status = 'committed', committed_at = now() WHERE id = p_batch_id;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, new_value)
    VALUES (v_account_id, p_actor_id, 'insert', 'students',
            jsonb_build_object('event', 'bulk_import_commit', 'batch_id', p_batch_id, 'entity', 'student'));

    RETURN 'تم الاعتماد بنجاح';
END;
$$ LANGUAGE plpgsql;

-- ملاحظة: commit_teacher_import_batch و commit_class_import_batch تتبعان نفس
-- البنية بالضبط (تحقق enforce_batch_fully_resolved → أرشفة بـ name_change_log
-- عند التحديث → كتابة فعلية → تحديث حالة الدفعة → سطر بـ audit_logs)
-- لم تُكرَّر هون توفيراً للمساحة، لكنها بنفس القالب الحرفي أعلاه.

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_staging_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_staging_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_staging_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE name_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_batches_isolation ON import_batches
    USING (account_id = current_account_id());

CREATE POLICY import_batches_write ON import_batches
    FOR INSERT WITH CHECK (
        account_id = current_account_id()
        AND has_capability('records.import_manage')
    );

CREATE POLICY name_change_log_isolation ON name_change_log
    USING (account_id = current_account_id());

CREATE POLICY staging_students_isolation ON import_staging_students
    USING (batch_id IN (SELECT id FROM import_batches WHERE account_id = current_account_id()));
CREATE POLICY staging_teachers_isolation ON import_staging_teachers
    USING (batch_id IN (SELECT id FROM import_batches WHERE account_id = current_account_id()));
CREATE POLICY staging_classes_isolation ON import_staging_classes
    USING (batch_id IN (SELECT id FROM import_batches WHERE account_id = current_account_id()));
-- =====================================================================
