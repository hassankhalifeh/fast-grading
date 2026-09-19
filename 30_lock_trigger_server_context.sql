-- =====================================================================
-- 30_lock_trigger_server_context.sql
-- الكتابة من سياق خادمي بلا مستخدم (service role / عمليات مجدولة) كانت تُرفض حتى لو
-- الامتحان غير مقفول لأن سلطة "الكاتب" تُحسب من صلاحيات المستخدم.
-- الآن: بلا مستخدم يُسمح فقط عند lock_tier = 0.
-- =====================================================================
CREATE OR REPLACE FUNCTION enforce_grades_admin_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_exam_id UUID := COALESCE(NEW.exam_id, OLD.exam_id);
    v_lock_tier SMALLINT;
BEGIN
    SELECT lock_tier INTO v_lock_tier FROM exams WHERE id = v_exam_id;
    IF auth.uid() IS NULL THEN
        IF v_lock_tier > 0 THEN
            RAISE EXCEPTION 'الامتحان معتمد/مقفول - الكتابة الخادمية ممنوعة قبل رفع القفل';
        END IF;
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF actor_exam_tier(v_exam_id) < v_lock_tier THEN
        RAISE EXCEPTION 'هاد الامتحان مقفول حالياً بمستوى أعلى من صلاحيتك - يلزم أن يرفع الناظر العام القفل درجة قبل ما تقدر تعدّل';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SET search_path = public;
