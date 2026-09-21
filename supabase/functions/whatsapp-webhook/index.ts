import { createClient } from "npm:@supabase/supabase-js@2";

// استقبال حالات التسليم (sent / delivered / read / failed) من Meta لكل مدرسة على حدة.
// عنوان كل مدرسة: .../whatsapp-webhook?a=<account_id> (تضعه المدرسة في تطبيقها لدى Meta).
// verify_jwt = false لأن Meta لا ترسل JWT؛ الحماية: رمز التحقق الخاص بالمدرسة (GET) وتوقيع X-Hub-Signature-256 بـApp Secret المدرسة (POST).
// التحديث محصور بحساب المدرسة نفسها فلا تتأثر رسائل مدرسة أخرى.

const enc = new TextEncoder();
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  return safeEqual([...sig].map((b) => b.toString(16).padStart(2, "0")).join(""), header.slice(7));
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("a") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return new Response("bad request", { status: 400 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: creds } = await admin.rpc("wa_get_credentials", { p_account: accountId });
  if (!creds) return new Response("forbidden", { status: 403 });

  if (req.method === "GET") {
    const given = u.searchParams.get("hub.verify_token") ?? "";
    if (u.searchParams.get("hub.mode") === "subscribe" && creds.webhook_verify_token && safeEqual(given, creds.webhook_verify_token)) {
      return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!creds.app_secret) return new Response("forbidden", { status: 403 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), creds.app_secret))) return new Response("bad signature", { status: 403 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
        const patch: Record<string, unknown> = { delivery_status: s.status };
        if (s.status === "delivered") patch.delivered_at = at;
        if (s.status === "read") patch.read_at = at;
        if (s.status === "failed") { patch.status = "failed"; patch.error_text = String(s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? "failed").slice(0, 300); }
        await admin.from("notifications_log").update(patch).eq("provider_message_id", s.id).eq("account_id", accountId);
      }
    }
  }
  return new Response("ok", { status: 200 });
});
