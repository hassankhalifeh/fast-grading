"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const lbl: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "var(--steel)", marginBottom: 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// إعداد مساعد الذكاء الاصطناعي على مستوى المنصة (جدول مغلق على مالك المنصة). لا يظهر المساعد لأي حساب إلا إذا كان الإعداد مفعّلاً
// وكانت الإضافة «مساعد الذكاء الاصطناعي» ممنوحة لذلك الحساب من جدول الحسابات أدناه.
export default function AiAssistantCard() {
  const [appId, setAppId] = useState("");
  const [url, setUrl] = useState("https://devology-ai.vercel.app");
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("ai_assistant_settings").select("application_id, gateway_url, enabled").eq("id", true).maybeSingle().then(({ data }) => {
      if (data) { setAppId(data.application_id ?? ""); if (data.gateway_url) setUrl(data.gateway_url); setEnabled(!!data.enabled); }
      setLoaded(true);
    });
  }, []);

  async function save() {
    setErr(null); setOk(null);
    if (appId.trim() && !UUID.test(appId.trim())) return setErr("معرّف التطبيق في Devology يجب أن يكون UUID");
    if (!/^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/i.test(url.trim())) return setErr("عنوان البوابة يجب أن يبدأ بـ https:// بلا مسار");
    if (enabled && !appId.trim()) return setErr("اكتب معرّف التطبيق قبل التفعيل");
    setBusy(true);
    const { error } = await supabase.from("ai_assistant_settings")
      .update({ application_id: appId.trim() || null, gateway_url: url.trim().toLowerCase(), enabled, updated_at: new Date().toISOString() }).eq("id", true);
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("حُفظ الإعداد");
  }

  if (!loaded) return null;
  return (
    <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: "1rem" }}>مساعد الذكاء الاصطناعي (Devology)</h3>
      <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--steel)", lineHeight: 1.8 }}>
        يظهر المساعد في لوحة التحكم لحساب معيّن فقط إذا كان هذا الإعداد مفعّلاً <b>و</b> مُنحت الإضافة «مساعد الذكاء الاصطناعي» لذلك الحساب من جدول الحسابات.
        في هذه المرحلة يقرأ المساعد أعداداً وأسماء صفوف ومواد وامتحانات ومتوسطات صفوف وأدلة المساعدة فقط، ولا تُرسل أسماء الطلاب ولا علاماتهم الفردية.
        كل قراءة تتم بصلاحيات المستخدم نفسه.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>معرّف التطبيق في Devology</label><input className="input" dir="ltr" style={{ width: 320 }} value={appId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(e) => setAppId(e.target.value)} /></div>
        <div><label style={lbl}>عنوان البوابة</label><input className="input" dir="ltr" style={{ width: 280 }} value={url} onChange={(e) => setUrl(e.target.value)} /></div>
        <label style={{ fontSize: "0.85rem", paddingBottom: 8 }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> مفعّل</label>
        <button className="btn btn-gold" disabled={busy} onClick={save}>{busy ? "جارٍ الحفظ..." : "حفظ"}</button>
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: "0.85rem", margin: "8px 0 0" }}>{err}</p>}
      {ok && <p style={{ color: "var(--green)", fontSize: "0.85rem", margin: "8px 0 0" }}>{ok}</p>}
    </div>
  );
}
