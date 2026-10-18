-- 57_service_role_table_grants.sql
-- إصلاح: service_role (الذي تستعمله كل Edge Functions) لم يكن يملك أي صلاحية على 47 جدولاً في مخطط fastgrading.
--
-- السبب: في المشروع القديم كان المخطط public يمنح service_role صلاحياته تلقائياً (default privileges)؛ أما المخطط
-- المخصَّص fastgrading في المشروع المشترك فلا يفعل ذلك، فبقيت الجداول المنشأة قبل الترحيلات 53+ بلا منح له.
-- الأثر الذي كُشف: لوحة المنصة لا تعرض الاشتراكات ولا الباقة ولا الاستعمال لأي حساب (قراءة subscription_profiles تفشل بصمت)،
-- وتبديل الإضافات وتعديل الحدود يفشلان، وإنشاء حساب جديد لا يطبّق حدوده وإضافاته. وقد تتأثر وظائف واتساب والاستيراد كذلك.
--
-- service_role يتجاوز RLS أصلاً (BYPASSRLS)، فمنحه صلاحيات الجداول يعيد السلوك السابق ولا يفتح شيئاً لـanon أو authenticated.
-- نضبط أيضاً default privileges كي لا تتكرر المشكلة مع كل جدول جديد.
set search_path to fastgrading;

grant all on all tables in schema fastgrading to service_role;
grant all on all sequences in schema fastgrading to service_role;

alter default privileges in schema fastgrading grant all on tables to service_role;
alter default privileges in schema fastgrading grant all on sequences to service_role;

reset search_path;
