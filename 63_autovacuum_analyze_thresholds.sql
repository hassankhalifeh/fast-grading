-- 63_autovacuum_analyze_thresholds.sql
-- جداول الحساب الأساسية تُحلَّل (ANALYZE) أسرع بعد أي استيراد أو إدخال كبير، وتُحلَّل أيضاً الجداول الصغيرة (حسابات تجريبية/جديدة).
--
-- السبب: بلا إحصاءات للجداول يختار المخطِّط خطط nested loop فيأخذ view السنة دقائق بدل ~100 مللي ثانية (قياس تركيبي: 1000 طالب،
-- 48 ألف علامة؛ انظر tools/tests/perf_views_benchmark.sql). الافتراضي (50 صفاً + 10% من الجدول) لا يحلّل الجداول الصغيرة أبداً،
-- ويتأخر على الكبيرة بعد استيراد جماعي. هنا: عتبة 10 صفوف + 2% من الجدول، ونحلّل الآن مرة واحدة.
-- التعديل خاص بهذه الجداول فقط (storage parameters) ويمكن التراجع عنه بـ ALTER TABLE ... RESET (...).
set search_path to fastgrading;

alter table grades                 set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table exams                  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table class_enrollments      set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table class_sections         set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table students               set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table assessment_items       set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table terms                  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table exam_type_components   set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table grading_overrides      set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table class_subject_teachers set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);
alter table supplementary_eligibility set (autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 10);

analyze grades; analyze exams; analyze class_enrollments; analyze class_sections; analyze students; analyze assessment_items;
analyze terms; analyze exam_type_components; analyze grading_overrides; analyze class_subject_teachers; analyze supplementary_eligibility;

reset search_path;
