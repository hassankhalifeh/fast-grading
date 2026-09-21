"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Power, ShieldCheck } from "lucide-react";

interface Status {
  entitled: boolean; enabled?: boolean; phone_number_id?: string | null; waba_id?: string | null; display_phone?: string | null; verified_name?: string | null;
  has_token?: boolean; has_app_secret?: boolean; status?: "not_configured" | "verified" | "error"; last_error?: string | null; last_checked_at?: string | null;
  webhook_verify_token?: string; account_id?: string;
}
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const STATUS_TEXT = { not_configured: "لم تُضبط بيانات الرقم بعد", verified: "متصل ✓", error: "خطأ في الاتصال" } as const;

// إعدادات واتساب للمدرسة: رقمها وحسابها لدى Meta. الاشتراك تفعّله إدارة المنصة، والتشغيل/الإيقاف والبيانات بيد المدرسة.
// الأسرار تُخزَّن مشفّرة في الخادم ولا تُعرض مرة أخرى بعد الحفظ.
export default function WhatsAppSettingsPanel({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [phoneId, setPhoneId] = useState("");
  const [waba, setWaba] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: e } = await supabase.rpc("get_whatsapp_status");
    if (e) return setError(e.message.includes("صلاحية") ? "ليس لديك صلاحية إعدادات المدرسة" : e.message);
    const s = data as Status;
    setSt(s);
    setPhoneId(s.phone_number_id ?? ""); setWaba(s.waba_id ?? "");
  }
  useEffect(() => { load(); }, []);

  async function toggle() {
    if (!st) return;
    setBusy(true); setError(null); setMessage(null);
    const { error: e } = await supabase.rpc("set_whatsapp_enabled", { p_enabled: !st.enabled });
    setBusy(false);
    if (e) return setError(e.message);
    setMessage(!st.enabled ? "شُغّلت الخدمة" : "أُوقفت الخدمة — تختفي شاشات المراسلات ولا يمكن الإرسال حتى تُشغَّل من جديد");
    await load(); onChanged();
  }

  async function call(action: "save" | "test") {
    setBusy(true); setError(null); setMessage(null);
    const { data, error: e } = await supabase.functions.invoke("whatsapp-admin", {
      body: { action, phone_number_id: phoneId, waba_id: waba || null, access_token: token || null, app_secret: appSecret || null },
    });
    setBusy(false);
    if (e || data?.error) { await load(); return setError(data?.error ?? e?.message ?? "تعذّر تنفيذ الطلب"); }
    setToken(""); setAppSecret("");
    setMessage(action === "save" ? `حُفظت البيانات والاتصال ناجح${data.verified_name ? ` (${data.verified_name})` : ""}` : "الاتصال سليم");
    await load(); onChanged();
  }

  if (!st) return error ? <p style={{ color: "var(--red)" }}>{error}</p> : <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p>;
  if (!st.entitled) return <p style={{ color: "var(--steel)" }}>هذه الخدمة غير مفعّلة لمدرستك. تواصل مع إدارة المنصة للاشتراك بها.</p>;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const hookUrl = `${base}/functions/v1/whatsapp-webhook?a=${st.account_id}`;
  const status = st.status ?? "not_configured";
  const stColor = status === "verified" ? "var(--green)" : status === "error" ? "var(--red)" : "var(--steel)";

  return (
    <div>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ShieldCheck size={18} color="var(--green)" /> <b>الاشتراك: مفعّل من إدارة المنصة</b>
          <button className="btn btn-secondary" disabled={busy} onClick={toggle} style={{ marginInlineStart: "auto" }}>
            <Power size={14} /> {st.enabled ? "إيقاف الخدمة لمدرستنا" : "تشغيل الخدمة"}
          </button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: st.enabled ? "var(--green)" : "var(--red)" }}>
          الخدمة حالياً: <b>{st.enabled ? "مشغّلة" : "موقوفة"}</b>{!st.enabled && " — لا تظهر شاشات المراسلات ولا يمكن الإرسال."}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
          الاتصال بواتساب: <b style={{ color: stColor }}>{STATUS_TEXT[status]}</b>
          {st.display_phone && <> — الرقم: <span dir="ltr">{st.display_phone}</span></>}{st.verified_name && <> — الاسم المعتمد: {st.verified_name}</>}
        </p>
        {st.last_error && status === "error" && <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--red)" }}>{st.last_error}</p>}
        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "var(--steel)" }}>
          بدون بيانات الاتصال تعمل المراسلات بأسلوب «فتح واتساب برسالة جاهزة» يدوياً. عند اكتمالها يُرسل تلقائياً من رقم مدرستك للرسائل التي اعتُمد قالبها لدى واتساب.
        </p>
      </div>

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>بيانات رقم واتساب المدرسة (من حسابكم لدى Meta)</h3>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div><label style={lbl}>معرّف الرقم (Phone Number ID)</label>
            <input className="input" dir="ltr" style={{ width: 240 }} value={phoneId} onChange={(e) => setPhoneId(e.target.value.replace(/\D/g, ""))} /></div>
          <div><label style={lbl}>معرّف حساب واتساب للأعمال (WABA ID)</label>
            <input className="input" dir="ltr" style={{ width: 240 }} value={waba} onChange={(e) => setWaba(e.target.value.replace(/\D/g, ""))} /></div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
          <div><label style={lbl}>رمز الوصول الدائم (Access Token)</label>
            <input className="input" type="password" autoComplete="new-password" dir="ltr" style={{ width: 300 }} value={token}
              placeholder={st.has_token ? "محفوظ — اتركه فارغاً للإبقاء عليه" : ""} onChange={(e) => setToken(e.target.value)} /></div>
          <div><label style={lbl}>App Secret (لتتبع التسليم والقراءة)</label>
            <input className="input" type="password" autoComplete="new-password" dir="ltr" style={{ width: 300 }} value={appSecret}
              placeholder={st.has_app_secret ? "محفوظ — اتركه فارغاً للإبقاء عليه" : "اختياري"} onChange={(e) => setAppSecret(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-gold" disabled={busy || !phoneId || (!token && !st.has_token)} onClick={() => call("save")}>{busy ? "جارٍ الفحص..." : "حفظ وفحص الاتصال"}</button>
          {st.has_token && <button className="btn btn-secondary" disabled={busy} onClick={() => call("test")}>فحص الاتصال فقط</button>}
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--steel)", marginBottom: 0 }}>
          تُفحص البيانات لدى Meta قبل حفظها، وتُخزَّن الأسرار مشفّرة على الخادم ولا تظهر بعد الحفظ. الرسائل تخرج من رقم مدرستكم وعلى حسابكم لدى Meta.
        </p>
      </div>

      <div className="card" style={{ padding: "1rem 1.1rem" }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>تتبع التسليم والقراءة (اختياري)</h3>
        <p style={{ fontSize: "0.82rem", margin: "0 0 8px" }}>في تطبيقكم لدى Meta ← WhatsApp ← Configuration ← Webhook ضعوا القيمتين التاليتين واشتركوا في الحقل <b>messages</b>:</p>
        <label style={lbl}>Callback URL</label>
        <input className="input" dir="ltr" readOnly style={{ width: "100%", maxWidth: 640 }} value={hookUrl} onFocus={(e) => e.target.select()} />
        <label style={{ ...lbl, marginTop: 10 }}>Verify token</label>
        <input className="input" dir="ltr" readOnly style={{ width: "100%", maxWidth: 640 }} value={st.webhook_verify_token ?? "يظهر بعد حفظ البيانات"} onFocus={(e) => e.target.select()} />
      </div>
    </div>
  );
}
