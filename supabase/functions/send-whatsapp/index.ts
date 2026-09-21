import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_PER_CALL = 200;
const CONCURRENCY = 5;

// إرسال دفعة إشعارات واتساب عبر WhatsApp Cloud API.
// الإرسال من رقم المدرسة نفسها: بياناتها (Phone Number ID والتوكن) في Vault وتُقرأ هنا بمفتاح الخدمة فقط.
// كل القراءة والتحديث تتم بجلسة المستخدم نفسه (RLS)، فلا يرسل أحد إلا لطلاب حسابه وبصلاحية notifications.send.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "غير مصرّح" }, 401);

  const version = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "جلسة غير صالحة" }, 401);

  // الاشتراك من المنصة + عدم إيقاف المدرسة للخدمة
  const { data: active } = await asUser.rpc("whatsapp_active");
  if (!active) return json({ error: "feature_disabled" }, 403);

  // بيانات واتساب الخاصة بالمدرسة (رقمها وحسابها) من الخزنة؛ لا تُرسل من رقم المنصة
  const { data: accountId } = await asUser.rpc("current_account_id");
  const { data: creds } = await admin.rpc("wa_get_credentials", { p_account: accountId });
  const token: string | null = creds?.token ?? null;
  const phoneId: string | null = creds?.phone_number_id ?? null;
  const configured = !!(token && phoneId && creds?.status === "verified");

  const { data: canSend } = await asUser.rpc("has_capability", { p_capability: "notifications.send" });
  if (!canSend) return json({ error: "الإرسال يتطلب الصلاحية notifications.send" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); }

  if (body.action === "status") return json({ configured });
  if (!configured) return json({ error: "not_configured" }, 409);

  const batchId = String(body.batch_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return json({ error: "batch_id غير صالح" }, 400);

  // لا إرسال قبل المراجعة والاعتماد (مفروض أيضاً بمُشغّل في قاعدة البيانات)
  const { data: batch } = await asUser.from("notification_batches").select("status").eq("id", batchId).maybeSingle();
  if (!batch || batch.status !== "approved") return json({ error: "batch_not_approved" }, 409);

  // حجز الصفوف ذرّياً: كل صف يُرسل مرة واحدة حتى لو استُدعيت الدالة مرتين.
  // الرسائل المعدّلة استثنائياً (بلا قالب معتمد) لا تُرسل تلقائياً؛ تبقى للإرسال اليدوي.
  const { data: claimed, error: claimErr } = await asUser.from("notifications_log")
    .update({ claimed_at: new Date().toISOString() })
    .eq("batch_id", batchId).eq("status", "pending").eq("channel", "whatsapp").eq("included", true).eq("moderation_status", "clean").not("wa_template_name", "is", null).is("claimed_at", null)
    .select("id, to_phone, rendered_message, wa_template_name, wa_language, wa_params")
    .limit(MAX_PER_CALL);
  if (claimErr) return json({ error: claimErr.message }, 400);
  const rows = claimed ?? [];

  let sent = 0, failed = 0;
  async function sendOne(r: any) {
    const to = String(r.to_phone ?? "").replace(/\D/g, "");
    const payload: any = { messaging_product: "whatsapp", to };
    if (r.wa_template_name) {
      payload.type = "template";
      payload.template = {
        name: r.wa_template_name,
        language: { code: r.wa_language ?? "ar" },
        components: [{ type: "body", parameters: ((r.wa_params ?? []) as string[]).map((t) => ({ type: "text", text: String(t) })) }],
      };
    } else {
      payload.type = "text";
      payload.text = { body: r.rendered_message, preview_url: false };
    }
    let messageId: string | null = null; let err: string | null = null;
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out?.messages?.[0]?.id) messageId = out.messages[0].id;
      else err = String(out?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
    } catch (e) { err = String((e as Error).message).slice(0, 300); }

    if (messageId) {
      sent++;
      await asUser.from("notifications_log").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: messageId, delivery_status: "accepted", error_text: null }).eq("id", r.id);
    } else {
      failed++;
      await asUser.from("notifications_log").update({ status: "failed", error_text: err }).eq("id", r.id);
    }
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) await Promise.all(rows.slice(i, i + CONCURRENCY).map(sendOne));
  return json({ processed: rows.length, sent, failed });
});
