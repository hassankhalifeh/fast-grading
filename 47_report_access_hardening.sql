-- 47: إغلاق الثغرة الحقيقية التي كانت شاشتا "المستخدمون" و"سجل التدقيق" في مركز التقارير تعتمدان على إخفائها
-- بالواجهة فقط. القراءة الآن مقيّدة في قاعدة البيانات نفسها.
--
-- ملاحظة صادقة: لم أُقيّد قراءة app_users نفسه (الجدول الأساسي) لأن عشرات الشاشات تعتمد على قراءته
-- عبر الحساب كله لعرض أسماء (من أعدّ الدفعة، من اعتمدها، الأستاذ المُسنَد، إلخ) — تقييده يكسر ميزات فعلية
-- كثيرة. بدل ذلك حوّلت تقرير "المستخدمون" ليقرأ عبر list_account_users() الموجودة أصلاً (SECURITY DEFINER
-- تتحقق من users.manage)، وقيّدت قراءة صلاحيات المستخدمين لتكون: نفسك، أو من يملك users.manage.

drop policy if exists audit_logs_read_own_account on public.audit_logs;
create policy audit_logs_read_own_account on public.audit_logs for select to authenticated
  using (
    account_id = current_account_id()
    and (has_capability('config.manage') or has_capability('users.manage') or has_capability('notifications.approve'))
  );

drop policy if exists user_capabilities_read on public.user_capabilities;
create policy user_capabilities_read on public.user_capabilities for select to authenticated
  using (app_user_id = current_app_user_id() or has_capability('users.manage'));
