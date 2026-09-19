import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// الأدوار القابلة للدعوة (solo_teacher لا يُدعى). القاعدة: رتبة المدعو أدنى من رتبة الداعي.
const ALLOWED = ["school_admin", "assistant_admin", "subject_teacher", "custom_role"];
const RANK: Record<string, number> = { solo_teacher: 4, school_admin: 3, assistant_admin: 2, subject_teacher: 1, custom_role: 1 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "غير مصرّح" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "جلسة غير صالحة" }, 401);

  const { data: me } = await asUser.from("app_users").select("id, account_id, role, is_active").eq("auth_uid", userData.user.id).maybeSingle();
  if (!me || !me.is_active) return json({ error: "حسابك غير فعّال" }, 403);

  const { data: canManage } = await asUser.rpc("has_capability", { p_capability: "users.manage" });
  if (!canManage) return json({ error: "دعوة المستخدمين تتطلب الصلاحية users.manage" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); }

  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "");
  const phone = body.phone ? String(body.phone).trim() : null;
  const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "بريد إلكتروني غير صالح" }, 400);
  if (!fullName) return json({ error: "الاسم مطلوب" }, 400);
  if (!ALLOWED.includes(role)) return json({ error: "دور غير مسموح بالدعوة" }, 400);
  if (RANK[role] >= RANK[me.role]) return json({ error: "لا يمكنك دعوة مستخدم بنفس رتبتك أو أعلى منها" }, 403);

  if (role === "school_admin") {
    const { data: existing } = await admin.from("app_users").select("id").eq("account_id", me.account_id).eq("role", "school_admin").eq("is_active", true).limit(1);
    if (existing && existing.length > 0) return json({ error: "يوجد ناظر عام فعّال بالفعل — لا يجوز ناظران عامان" }, 409);
  }

  const { data: dup } = await admin.from("app_users").select("id").eq("account_id", me.account_id).ilike("email", email).limit(1);
  if (dup && dup.length > 0) return json({ error: "هذا البريد مسجّل مسبقاً في حسابك" }, 409);

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, needs_password: true },
    redirectTo,
  });
  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message ?? "تعذر إرسال الدعوة";
    return json({ error: msg.toLowerCase().includes("registered") ? "هذا البريد مسجّل مسبقاً في النظام" : msg }, 400);
  }

  const { data: created, error: insertErr } = await admin.from("app_users").insert({
    account_id: me.account_id, auth_uid: invited.user.id, full_name: fullName, email, phone, role,
  }).select("id").single();
  if (insertErr || !created) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: "تعذر إنشاء المستخدم: " + (insertErr?.message ?? "") }, 500);
  }

  await admin.rpc("apply_default_capabilities", { p_app_user_id: created.id, p_role: role });
  await admin.from("audit_logs").insert({
    account_id: me.account_id, user_id: me.id, action_type: "insert", table_name: "app_users", record_id: created.id,
    new_value: { event: "user_invited", role, email },
  });

  return json({ ok: true, message: "أُرسلت الدعوة إلى " + email, user_id: created.id });
});
