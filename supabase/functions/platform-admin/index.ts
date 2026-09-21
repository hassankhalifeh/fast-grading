import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// الإضافات المسموح تفعيلها (تُضاف هنا كلما ظهرت إضافة جديدة)
const FEATURES = ["whatsapp_notifications"];

// أدوات مالك المنصة فقط (platform_admins): قائمة المدارس، إنشاء مدرسة جديدة مع مديرها الأول، تفعيل/إيقاف الإضافات.
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
  const { data: isAdmin } = await asUser.rpc("is_platform_admin");
  if (!isAdmin) return json({ error: "هذه الأدوات لمالك المنصة فقط" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); }

  if (body.action === "list") {
    const { data: accounts, error } = await admin.from("accounts").select("id, display_name, account_type, created_at").order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    const [users, students, feats] = await Promise.all([
      admin.from("app_users").select("account_id, is_active"),
      admin.from("students").select("account_id"),
      admin.from("account_features").select("account_id, feature_key, enabled"),
    ]);
    const count = (rows: any[] | null, id: string, pred: (r: any) => boolean = () => true) => (rows ?? []).filter((r) => r.account_id === id && pred(r)).length;
    return json({
      features: FEATURES,
      schools: (accounts ?? []).map((a) => ({
        ...a,
        users: count(users.data, a.id, (r) => r.is_active),
        students: count(students.data, a.id),
        enabled_features: (feats.data ?? []).filter((f) => f.account_id === a.id && f.enabled).map((f) => f.feature_key),
      })),
    });
  }

  // ===== ضبط المحتوى: مخالفات كل المدارس + القاموس العام =====
  if (body.action === "violations") {
    const status = body.status === "all" ? null : String(body.status ?? "open");
    let q = admin.from("message_violations").select("*").order("occurred_at", { ascending: false }).limit(300);
    if (status) q = q.eq("review_status", status);
    const [v, a] = await Promise.all([q, admin.from("accounts").select("id, display_name")]);
    if (v.error) return json({ error: v.error.message }, 500);
    const names = new Map((a.data ?? []).map((x: any) => [x.id, x.display_name]));
    return json({ violations: (v.data ?? []).map((x: any) => ({ ...x, school: names.get(x.account_id) ?? "—" })) });
  }
  if (body.action === "review_violation") {
    const st = String(body.status ?? "");
    if (!["open", "confirmed", "dismissed"].includes(st)) return json({ error: "حالة غير صالحة" }, 400);
    const { error } = await admin.from("message_violations").update({
      review_status: st, reviewed_by: null, reviewed_by_name: "إدارة المنصة", reviewed_at: new Date().toISOString(), review_note: body.note ? String(body.note).slice(0, 500) : null,
    }).eq("id", String(body.id ?? ""));
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  if (body.action === "terms_list") {
    const { data, error } = await admin.from("moderation_terms").select("id, term, category, kind, active").is("account_id", null).order("category").order("term");
    if (error) return json({ error: error.message }, 500);
    return json({ terms: data ?? [] });
  }
  if (body.action === "terms_add") {
    const term = String(body.term ?? "").trim();
    const category = String(body.category ?? "other");
    const kind = body.kind === "allow" ? "allow" : "block";
    if (!term) return json({ error: "المصطلح مطلوب" }, 400);
    if (!["sexual", "profanity", "insult", "threat", "other"].includes(category)) return json({ error: "تصنيف غير صالح" }, 400);
    const { error } = await admin.from("moderation_terms").insert({ account_id: null, term, category, kind });
    if (error) return json({ error: error.message.includes("duplicate") ? "المصطلح موجود مسبقاً" : error.message }, 400);
    return json({ ok: true });
  }
  if (body.action === "terms_remove") {
    const { error } = await admin.from("moderation_terms").delete().eq("id", String(body.id ?? "")).is("account_id", null);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "set_feature") {
    const accountId = String(body.account_id ?? "");
    const key = String(body.feature_key ?? "");
    if (!FEATURES.includes(key)) return json({ error: "إضافة غير معروفة" }, 400);
    const { data: acc } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
    if (!acc) return json({ error: "مدرسة غير موجودة" }, 404);
    const { error } = await admin.from("account_features").upsert(
      { account_id: accountId, feature_key: key, enabled: !!body.enabled, note: body.note ? String(body.note).slice(0, 200) : null },
      { onConflict: "account_id,feature_key" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "create_school") {
    const name = String(body.name ?? "").trim();
    const email = String(body.admin_email ?? "").trim().toLowerCase();
    const adminName = String(body.admin_name ?? "").trim();
    const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
    const features: string[] = Array.isArray(body.features) ? body.features.filter((f: string) => FEATURES.includes(f)) : [];
    if (!name) return json({ error: "اسم المدرسة مطلوب" }, 400);
    if (!adminName) return json({ error: "اسم مدير المدرسة مطلوب" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "بريد إلكتروني غير صالح" }, 400);

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: adminName, needs_password: true }, redirectTo,
    });
    if (inviteErr || !invited?.user) {
      const msg = inviteErr?.message ?? "تعذر إرسال الدعوة";
      return json({ error: msg.toLowerCase().includes("registered") ? "هذا البريد مسجّل مسبقاً في النظام" : msg }, 400);
    }
    const rollback = async (accountId?: string) => {
      if (accountId) await admin.from("accounts").delete().eq("id", accountId);
      await admin.auth.admin.deleteUser(invited.user.id);
    };

    const { data: account, error: accErr } = await admin.from("accounts").insert({ account_type: "school_enterprise", display_name: name }).select("id").single();
    if (accErr || !account) { await rollback(); return json({ error: "تعذر إنشاء المدرسة: " + (accErr?.message ?? "") }, 500); }

    const { data: created, error: userInsErr } = await admin.from("app_users").insert({
      account_id: account.id, auth_uid: invited.user.id, full_name: adminName, email, role: "school_admin",
    }).select("id").single();
    if (userInsErr || !created) { await rollback(account.id); return json({ error: "تعذر إنشاء المدير: " + (userInsErr?.message ?? "") }, 500); }

    await admin.rpc("apply_default_capabilities", { p_app_user_id: created.id, p_role: "school_admin" });
    await admin.from("grading_policies").insert({ account_id: account.id });
    if (features.length > 0) {
      await admin.from("account_features").insert(features.map((f) => ({ account_id: account.id, feature_key: f, note: "عند إنشاء المدرسة" })));
    }
    return json({ ok: true, account_id: account.id, message: "أُنشئت المدرسة وأُرسلت الدعوة إلى " + email });
  }

  return json({ error: "إجراء غير معروف" }, 400);
});
