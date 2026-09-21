import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// حفظ وفحص بيانات واتساب الخاصة بالمدرسة (رقمها وحسابها لدى Meta). تُتحقق من Meta أولاً، ثم تُخزَّن الأسرار في Vault.
// لا تعيد أي سر للمتصفح. تتطلب اشتراكاً مفعّلاً من المنصة وصلاحية config.manage.
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

  const { data: accountId } = await asUser.rpc("current_account_id");
  if (!accountId) return json({ error: "حسابك غير مرتبط بمدرسة" }, 403);
  const { data: entitled } = await asUser.rpc("account_has_feature", { p_key: "whatsapp_notifications" });
  if (!entitled) return json({ error: "الخدمة غير مشترك بها — تواصل مع إدارة المنصة" }, 403);
  const { data: canManage } = await asUser.rpc("has_capability", { p_capability: "config.manage" });
  if (!canManage) return json({ error: "تعديل إعدادات واتساب يتطلب صلاحية إعدادات المدرسة" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); }
  const action = body.action;
  if (action !== "save" && action !== "test") return json({ error: "إجراء غير معروف" }, 400);

  const { data: stored } = await admin.rpc("wa_get_credentials", { p_account: accountId });
  const phoneId = String(body.phone_number_id ?? stored?.phone_number_id ?? "").trim();
  const waba = body.waba_id ? String(body.waba_id).trim() : null;
  const newToken = body.access_token ? String(body.access_token).trim() : null;
  const newAppSecret = body.app_secret ? String(body.app_secret).trim() : null;
  const token = newToken ?? stored?.token ?? null;

  if (!/^\d{5,20}$/.test(phoneId)) return json({ error: "معرّف الرقم (Phone Number ID) أرقام فقط" }, 400);
  if (waba && !/^\d{5,20}$/.test(waba)) return json({ error: "معرّف الحساب (WABA ID) أرقام فقط" }, 400);
  if (!token) return json({ error: "التوكن (Access Token) مطلوب" }, 400);

  // التحقق من Meta قبل حفظ أي شيء
  let display: string | null = null; let name: string | null = null; let failure: string | null = null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
    const out = await res.json().catch(() => ({}));
    if (res.ok) { display = out.display_phone_number ?? null; name = out.verified_name ?? null; }
    else failure = String(out?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
  } catch (e) { failure = String((e as Error).message).slice(0, 300); }

  if (failure) {
    if (stored?.phone_number_id) await admin.rpc("wa_set_status", { p_account: accountId, p_status: "error", p_error: failure });
    return json({ error: "رفضت Meta البيانات: " + failure }, 400);
  }

  if (action === "test") {
    await admin.rpc("wa_set_status", { p_account: accountId, p_status: "verified", p_error: null });
    return json({ ok: true, display_phone: display, verified_name: name });
  }

  const { error: storeErr } = await admin.rpc("wa_store_credentials", {
    p_account: accountId, p_phone_id: phoneId, p_waba: waba, p_token: newToken, p_app_secret: newAppSecret, p_display: display, p_name: name,
  });
  if (storeErr) return json({ error: "تعذّر حفظ البيانات" }, 500);
  return json({ ok: true, display_phone: display, verified_name: name });
});
