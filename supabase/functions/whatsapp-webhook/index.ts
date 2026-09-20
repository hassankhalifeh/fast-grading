import { createClient } from "npm:@supabase/supabase-js@2";

// استقبال حالات التسليم من Meta (sent / delivered / read / failed) وتحديث notifications_log.
// verify_jwt = false لأن Meta لا ترسل JWT؛ الحماية بتوقيع X-Hub-Signature-256 (WHATSAPP_APP_SECRET) ورمز التحقق (WHATSAPP_VERIFY_TOKEN).

const enc = new TextEncoder();
async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!verifyToken || !appSecret) return new Response("not configured", { status: 503 });

  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === verifyToken) {
      return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) return new Response("bad signature", { status: 403 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();
        const patch: Record<string, unknown> = { delivery_status: s.status };
        if (s.status === "delivered") patch.delivered_at = at;
        if (s.status === "read") patch.read_at = at;
        if (s.status === "failed") { patch.status = "failed"; patch.error_text = String(s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? "failed").slice(0, 300); }
        await admin.from("notifications_log").update(patch).eq("provider_message_id", s.id);
      }
    }
  }
  return new Response("ok", { status: 200 });
});
