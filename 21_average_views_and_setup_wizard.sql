-- =====================================================================
-- 21_average_views_and_setup_wizard.sql
-- الحساب الآلي بالتسلسل: امتحان ← بند ← فصل ← سنة، باستخدام الأوزان الفعلية
-- (الافتراضي + تجاوزات المرحلة/الصف/المادة). الأوزان نسبية ومطبّعة على
-- الموجود فعلاً، فالمعدل مؤقت لحين اكتمال العلامات (items_present/items_total
-- بتخلي التقارير تعرض مدى الاكتمال). وزن 0 = البند غير مفعّل لذلك النطاق.
-- يحافظ على أعمدة v_student_term_average القديمة عشان v_student_class_rank
-- و v_class_term_summary و v_school_term_summary تستمر تعمل بدون تعديل.
-- =====================================================================

CREATE OR REPLACE VIEW v_exam_percent WITH (security_invoker = true) AS
SELECT e.account_id, ees.exam_id, ees.student_id, e.class_section_id, e.subject_id,
       e.item_id, e.term_id,
       ees.effective_score / NULLIF(e.max_score, 0) * 100 AS percent,
       ees.all_confirmed
FROM v_exam_effective_score ees
JOIN exams e ON e.id = ees.exam_id;

CREATE OR REPLACE VIEW v_student_subject_item WITH (security_invoker = true) AS
SELECT p.account_id, p.student_id, p.class_section_id, p.subject_id, p.item_id, p.term_id,
       sum(p.percent * w.w) / NULLIF(sum(w.w), 0) AS item_score,
       count(*) AS exams_count
FROM v_exam_percent p
CROSS JOIN LATERAL (SELECT effective_exam_weight(p.exam_id, p.class_section_id, p.subject_id) AS w) w
WHERE p.all_confirmed AND p.item_id IS NOT NULL
GROUP BY p.account_id, p.student_id, p.class_section_id, p.subject_id, p.item_id, p.term_id;

CREATE OR REPLACE VIEW v_student_subject_term WITH (security_invoker = true) AS
SELECT s.account_id, s.student_id, s.class_section_id, s.subject_id, s.term_id,
       sum(s.item_score * iw.w) / NULLIF(sum(iw.w), 0) AS subject_term_score,
       count(*) FILTER (WHERE iw.w > 0) AS items_present,
       (SELECT count(*) FROM assessment_items x
         WHERE x.term_id = s.term_id
           AND effective_item_weight(x.id, s.class_section_id, s.subject_id) > 0) AS items_total
FROM v_student_subject_item s
CROSS JOIN LATERAL (SELECT effective_item_weight(s.item_id, s.class_section_id, s.subject_id) AS w) iw
GROUP BY s.account_id, s.student_id, s.class_section_id, s.subject_id, s.term_id;

-- نفس أعمدة النسخة القديمة (student_id, term_id, class_section_id, term_average)
CREATE OR REPLACE VIEW v_student_term_average WITH (security_invoker = true) AS
SELECT student_id, term_id, class_section_id, avg(subject_term_score) AS term_average
FROM v_student_subject_term
GROUP BY student_id, term_id, class_section_id;

CREATE OR REPLACE VIEW v_student_subject_year WITH (security_invoker = true) AS
SELECT s.account_id, s.student_id, s.class_section_id, s.subject_id,
       sum(s.subject_term_score * tw.w) / NULLIF(sum(tw.w), 0) AS subject_year_score,
       count(*) FILTER (WHERE tw.w > 0) AS terms_present
FROM v_student_subject_term s
CROSS JOIN LATERAL (SELECT effective_term_weight(s.term_id, s.class_section_id, s.subject_id) AS w) tw
GROUP BY s.account_id, s.student_id, s.class_section_id, s.subject_id;

CREATE OR REPLACE VIEW v_student_year_rank WITH (security_invoker = true) AS
SELECT student_id, class_section_id, year_average,
       rank() OVER (PARTITION BY class_section_id ORDER BY year_average DESC) AS rank_in_class,
       count(*) OVER (PARTITION BY class_section_id) AS class_size
FROM (
    SELECT student_id, class_section_id, avg(subject_year_score) AS year_average
    FROM v_student_subject_year
    GROUP BY student_id, class_section_id
) t;

-- ---------------------------------------------------------------------
-- معالج الإعداد السريع: يولّد سنة + فصول + بنود بأوزان افتراضية (قابلة للتعديل)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION setup_academic_structure(
    p_year_name TEXT,
    p_terms INTEGER,
    p_coursework_per_term INTEGER,
    p_has_term_exam BOOLEAN,
    p_coursework_share NUMERIC DEFAULT 30
) RETURNS TEXT AS $$
DECLARE
    v_acc UUID := current_account_id();
    v_year UUID;
    v_term UUID;
    v_names TEXT[] := ARRAY['الأول','الثاني','الثالث','الرابع','الخامس','السادس'];
    v_cw_w NUMERIC;
    v_exam_w NUMERIC;
    i INTEGER;
    j INTEGER;
    v_order INTEGER;
BEGIN
    IF NOT has_capability('config.manage') THEN
        RAISE EXCEPTION 'لا تملك صلاحية إدارة الإعدادات (config.manage)';
    END IF;
    IF p_terms NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'عدد الفصول يجب أن يكون بين 1 و 6'; END IF;
    IF p_coursework_per_term NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'عدد السعي لكل فصل يجب أن يكون بين 0 و 6'; END IF;
    IF p_coursework_per_term = 0 AND NOT p_has_term_exam THEN
        RAISE EXCEPTION 'يجب أن يحتوي الفصل على بند تقييم واحد على الأقل';
    END IF;
    IF p_coursework_per_term > 0 AND p_has_term_exam AND (p_coursework_share <= 0 OR p_coursework_share >= 100) THEN
        RAISE EXCEPTION 'نسبة السعي يجب أن تكون بين 0 و 100 (غير شاملة)';
    END IF;
    IF EXISTS (SELECT 1 FROM assessment_items WHERE account_id = v_acc) THEN
        RAISE EXCEPTION 'الهيكل الأكاديمي معدّ مسبقاً - عدّله من الشاشة بدل إعادة المعالج';
    END IF;

    IF p_coursework_per_term > 0 AND p_has_term_exam THEN
        v_cw_w := p_coursework_share / p_coursework_per_term;
        v_exam_w := 100 - p_coursework_share;
    ELSIF p_coursework_per_term > 0 THEN
        v_cw_w := 100.0 / p_coursework_per_term;
    ELSE
        v_exam_w := 100;
    END IF;

    UPDATE academic_years SET is_current = false WHERE account_id = v_acc AND is_current;
    INSERT INTO academic_years (account_id, name, is_current) VALUES (v_acc, p_year_name, true) RETURNING id INTO v_year;

    FOR i IN 1..p_terms LOOP
        INSERT INTO terms (account_id, name, academic_year_id, order_index, default_weight)
        VALUES (v_acc, 'الفصل ' || v_names[i], v_year, i, 100.0 / p_terms)
        RETURNING id INTO v_term;

        v_order := 0;
        FOR j IN 1..p_coursework_per_term LOOP
            v_order := v_order + 1;
            INSERT INTO assessment_items (account_id, term_id, name, kind, order_index, default_weight)
            VALUES (v_acc, v_term, CASE WHEN p_coursework_per_term = 1 THEN 'السعي' ELSE 'سعي ' || j END,
                    'coursework', v_order, v_cw_w);
        END LOOP;
        IF p_has_term_exam THEN
            v_order := v_order + 1;
            INSERT INTO assessment_items (account_id, term_id, name, kind, order_index, default_weight)
            VALUES (v_acc, v_term, 'امتحان الفصل', 'term_exam', v_order, v_exam_w);
        END IF;
    END LOOP;

    RETURN format('تم إنشاء %s فصل و %s بند تقييم لكل فصل', p_terms,
                  p_coursework_per_term + CASE WHEN p_has_term_exam THEN 1 ELSE 0 END);
END;
$$ LANGUAGE plpgsql SET search_path = public;
-- =====================================================================
