-- =====================================================================
-- 25_user_management.sql
-- إدارة المستخدمين: ترتيب الرتب، قائمة المستخدمين بحالة الدعوة، وتفعيل/تعطيل.
-- الدعوة نفسها (إنشاء مستخدم Auth) عبر Edge Function invite-user لأنها تحتاج
-- service role ولا يجوز من المتصفح.
-- قاعدة الرتب: المدعو/المعدَّل رتبته أدنى من رتبة صاحب الطلب.
-- =====================================================================

CREATE OR REPLACE FUNCTION role_rank(p_role user_role_enum)
RETURNS INTEGER AS $$
    SELECT CASE p_role
        WHEN 'solo_teacher'    THEN 4
        WHEN 'school_admin'    THEN 3
        WHEN 'assistant_admin' THEN 2
        WHEN 'subject_teacher' THEN 1
        WHEN 'custom_role'     THEN 1
    END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION list_account_users()
RETURNS TABLE (
    id UUID, full_name TEXT, email TEXT, phone TEXT, role user_role_enum,
    is_active BOOLEAN, accepted BOOLEAN, last_sign_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ
) AS $$
    SELECT au.id, au.full_name, au.email, au.phone, au.role, au.is_active,
           (u.email_confirmed_at IS NOT NULL) AS accepted, u.last_sign_in_at, au.created_at
    FROM app_users au
    LEFT JOIN auth.users u ON u.id = au.auth_uid
    WHERE au.account_id = current_account_id()
      AND has_capability('users.manage')
    ORDER BY role_rank(au.role) DESC, au.created_at;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION set_user_active(p_user UUID, p_active BOOLEAN)
RETURNS TEXT AS $$
DECLARE
    v_me app_users%ROWTYPE;
    v_target app_users%ROWTYPE;
BEGIN
    IF NOT has_capability('users.manage') THEN
        RAISE EXCEPTION 'إدارة المستخدمين تتطلب الصلاحية users.manage';
    END IF;
    SELECT * INTO v_me FROM app_users WHERE auth_uid = auth.uid();
    SELECT * INTO v_target FROM app_users WHERE id = p_user AND account_id = v_me.account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم غير موجود'; END IF;
    IF v_target.id = v_me.id THEN RAISE EXCEPTION 'لا يمكنك تعطيل نفسك'; END IF;
    IF role_rank(v_target.role) >= role_rank(v_me.role) THEN
        RAISE EXCEPTION 'لا يمكنك تعديل مستخدم بنفس رتبتك أو أعلى منها';
    END IF;

    UPDATE app_users SET is_active = p_active WHERE id = p_user;

    INSERT INTO audit_logs (account_id, user_id, action_type, table_name, record_id, new_value)
    VALUES (v_me.account_id, v_me.id, 'update', 'app_users', p_user,
            jsonb_build_object('event', 'user_active_changed', 'is_active', p_active));

    RETURN CASE WHEN p_active THEN 'تم تفعيل المستخدم' ELSE 'تم تعطيل المستخدم' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.role_rank(user_role_enum) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_account_users() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_rank(user_role_enum) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) TO authenticated;
-- =====================================================================
