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
const ACCOUNT_TYPES = ["solo_teacher", "school_enterprise"];

function readLimits(body: any) {
  const n = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
  const l = body.limits ?? {};
  return {
    default_class_limit: n(l.max_classes, 200),
    default_student_per_class: n(l.max_students_per_class, 100),
    default_total_student_limit: n(l.max_total_students, 5000),
    max_buildings: n(l.max_buildings, 10),
    max_stages: n(l.max_stages, 20),
  };
}

// أدوات مالك المنصة فقط (platform_admins): قائمة الحسابات، إنشاء حساب جديد (solo أو مدرسة) بحدوده وتاريخ انتهائه،
// تعديل حدود حساب قائم، تفعيل/إيقاف الإضافات، مراجعة مخالفات المحتوى والقاموس العام.
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
    const [users, students, feats, subs, buildings, stages, classes] = await Promise.all([
      admin.from("app_users").select("account_id, is_active"),
      admin.from("students").select("account_id"),
      admin.from("account_features").select("account_id, feature_key, enabled"),
      admin.from("subscription_profiles").select("*"),
      admin.from("buildings").select("account_id"),
      admin.from("stages").select("account_id"),
      admin.from("class_sections").select("account_id, is_active"),
    ]);
    const count = (rows: any[] | null, id: string, pred: (r: any) => boolean = () => true) => (rows ?? []).filter((r) => r.account_id === id && pred(r)).length;
    const now = Date.now();
    return json({
      features: FEATURES,
      schools: (accounts ?? []).map((a) => {
        const sp: any = (subs.data ?? []).find((s: any) => s.account_id === a.id) ?? null;
        const daysLeft = sp?.expires_at ? Math.ceil((new Date(sp.expires_at).getTime() - now) / 86400000) : null;
        const subStatus = !sp ? "active" : sp.status === "suspended" ? "suspended" : daysLeft !== null && daysLeft < 0 ? "expired" : daysLeft !== null && daysLeft <= 14 ? "expiring_soon" : "active";
        return {
          ...a,
          users: count(users.data, a.id, (r) => r.is_active),
          students: count(students.data, a.id),
          enabled_features: (feats.data ?? []).filter((f) => f.account_id === a.id && f.enabled).map((f) => f.feature_key),
          subscription: sp && {
            plan_type: sp.plan_type, status: sp.status, expires_at: sp.expires_at, days_left: daysLeft, sub_status: subStatus, notes: sp.notes,
            limits: {
              max_classes: sp.default_class_limit + sp.allowed_class_extension, max_students_per_class: sp.default_student_per_class,
              max_total_students: sp.default_total_student_limit + sp.allowed_student_extension, max_buildings: sp.max_buildings, max_stages: sp.max_stages,
            },
            usage: { classes: count(classes.data, a.id, (r) => r.is_active), buildings: count(buildings.data, a.id), stages: count(stages.data, a.id) },
          },
        };
      }),
    });
  }

  if (body.action === "get_account") {
    const accountId = String(body.account_id ?? "");
    const [acc, sp, cls] = await Promise.all([
      admin.from("accounts").select("id, display_name, account_type, created_at").eq("id", accountId).maybeSingle(),
      admin.from("subscription_profiles").select("*").eq("account_id", accountId).maybeSingle(),
      admin.from("class_sections").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("is_active", true),
    ]);
    if (!acc.data) return json({ error: "حساب غير موجود" }, 404);
    return json({ account: acc.data, subscription: sp.data, active_classes: cls.count ?? 0 });
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
    if (!acc) return json({ error: "حساب غير موجود" }, 404);
    const { error } = await admin.from("account_features").upsert(
      { account_id: accountId, feature_key: key, enabled: !!body.enabled, note: body.note ? String(body.note).slice(0, 200) : null },
      { onConflict: "account_id,feature_key" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // تعديل حدود/انتهاء/حالة حساب قائم (بلا حاجة لإعادة إنشائه)
  if (body.action === "update_account") {
    const accountId = String(body.account_id ?? "");
    const { data: acc } = await admin.from("accounts").select("id").eq("id", accountId).maybeSingle();
    if (!acc) return json({ error: "حساب غير موجود" }, 404);
    const status = body.status === "suspended" ? "suspended" : "active";
    const expiresAt = body.expires_at === null || body.expires_at === "" ? null : body.expires_at ? new Date(body.expires_at).toISOString() : undefined;
    const patch: Record<string, unknown> = { ...readLimits(body), status, updated_by_platform: true };
    if (expiresAt !== undefined) patch.expires_at = expiresAt;
    if (body.plan_type) patch.plan_type = String(body.plan_type).slice(0, 60);
    if (body.note !== undefined) patch.notes = body.note ? String(body.note).slice(0, 500) : null;
    const { error } = await admin.from("subscription_profiles").upsert({ account_id: accountId, ...patch }, { onConflict: "account_id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "create_account") {
    const name = String(body.name ?? "").trim();
    const email = String(body.admin_email ?? "").trim().toLowerCase();
    const adminName = String(body.admin_name ?? "").trim();
    const redirectTo = body.redirect_to ? String(body.redirect_to) : undefined;
    const accountType = ACCOUNT_TYPES.includes(body.account_type) ? body.account_type : "school_enterprise";
    const features: string[] = Array.isArray(body.features) ? body.features.filter((f: string) => FEATURES.includes(f)) : [];
    const expiresAt = body.expires_at ? new Date(body.expires_at).toISOString() : null;
    if (!name) return json({ error: accountType === "solo_teacher" ? "اسم الحساب مطلوب" : "اسم المدرسة مطلوب" }, 400);
    if (!adminName) return json({ error: "الاسم مطلوب" }, 400);
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

    const { data: account, error: accErr } = await admin.from("accounts").insert({ account_type: accountType, display_name: name }).select("id").single();
    if (accErr || !account) { await rollback(); return json({ error: "تعذر إنشاء الحساب: " + (accErr?.message ?? "") }, 500); }

    const role = accountType === "solo_teacher" ? "solo_teacher" : "school_admin";
    const { data: created, error: userInsErr } = await admin.from("app_users").insert({
      account_id: account.id, auth_uid: invited.user.id, full_name: adminName, email, role,
    }).select("id").single();
    if (userInsErr || !created) { await rollback(account.id); return json({ error: "تعذر إنشاء المستخدم: " + (userInsErr?.message ?? "") }, 500); }

    await admin.rpc("apply_default_capabilities", { p_app_user_id: created.id, p_role: role });
    await admin.from("grading_policies").insert({ account_id: account.id });
    // الحساب حصل على سجل حدود افتراضي تلقائياً (المُشغّل)؛ نستبدله بما اختاره مالك المنصة عند الإنشاء
    await admin.from("subscription_profiles").update({
      ...readLimits(body), expires_at: expiresAt, status: "active", updated_by_platform: true,
      plan_type: body.plan_type ? String(body.plan_type).slice(0, 60) : (accountType === "solo_teacher" ? "solo_teacher_paid" : "school_custom"),
      notes: body.note ? String(body.note).slice(0, 500) : null,
    }).eq("account_id", account.id);
    if (features.length > 0) {
      await admin.from("account_features").insert(features.map((f) => ({ account_id: account.id, feature_key: f, note: "عند إنشاء الحساب" })));
    }
    return json({ ok: true, account_id: account.id, message: "أُنشئ الحساب وأُرسلت الدعوة إلى " + email });
  }

  return json({ error: "إجراء غير معروف" }, 400);
});
