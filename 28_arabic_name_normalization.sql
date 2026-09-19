-- =====================================================================
-- 28_arabic_name_normalization.sql
-- تطبيع الأسماء العربية قبل المطابقة بالاستيراد: إزالة التشكيل والتطويل، توحيد
-- الألف (أإآٱ→ا)، ى→ي، ة→ه، ضغط المسافات. بدونه الاختلافات الإملائية الشائعة
-- كانت تُنزل التشابه تحت العتبة فتظهر النسخ المكررة كطلاب جدد.
-- =====================================================================
CREATE OR REPLACE FUNCTION normalize_ar(t TEXT)
RETURNS TEXT AS $$
    SELECT lower(trim(regexp_replace(
        translate(regexp_replace(COALESCE(t, ''), '[\u064B-\u0652\u0640]', '', 'g'), 'أإآٱىة', 'اااايه'),
        '\s+', ' ', 'g')));
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION analyze_student_import_batch(p_batch_id UUID)
RETURNS VOID AS $$
DECLARE
    v_row RECORD;
    v_best RECORD;
BEGIN
    FOR v_row IN SELECT * FROM import_staging_students WHERE batch_id = p_batch_id LOOP
        SELECT s.id, s.full_name,
               similarity(normalize_ar(s.full_name), normalize_ar(v_row.raw_full_name)) AS sim
        INTO v_best
        FROM students s
        JOIN class_enrollments ce ON ce.student_id = s.id AND ce.class_section_id = v_row.raw_class_section_id
        ORDER BY sim DESC
        LIMIT 1;

        IF v_best.id IS NULL THEN
            UPDATE import_staging_students SET match_status = 'new', matched_student_id = NULL, similarity_score = NULL WHERE id = v_row.id;
        ELSIF v_best.sim >= 0.999 THEN
            UPDATE import_staging_students SET match_status = 'identical', matched_student_id = v_best.id, similarity_score = v_best.sim WHERE id = v_row.id;
        ELSIF v_best.sim >= 0.55 THEN
            UPDATE import_staging_students SET match_status = 'conflict', matched_student_id = v_best.id, similarity_score = v_best.sim WHERE id = v_row.id;
        ELSE
            UPDATE import_staging_students SET match_status = 'new', matched_student_id = NULL, similarity_score = NULL WHERE id = v_row.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION analyze_class_import_batch(p_batch_id UUID)
RETURNS VOID AS $$
    UPDATE import_staging_classes s
    SET match_status = CASE WHEN EXISTS (
            SELECT 1 FROM class_sections c JOIN import_batches b ON b.id = s.batch_id
            WHERE c.account_id = b.account_id AND normalize_ar(c.name) = normalize_ar(s.raw_name)) THEN 'identical'::import_row_match_enum
        ELSE 'new'::import_row_match_enum END,
        matched_class_id = (SELECT c.id FROM class_sections c JOIN import_batches b ON b.id = s.batch_id
            WHERE c.account_id = b.account_id AND normalize_ar(c.name) = normalize_ar(s.raw_name) LIMIT 1)
    WHERE s.batch_id = p_batch_id;
$$ LANGUAGE sql SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.normalize_ar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_ar(text) TO authenticated;
