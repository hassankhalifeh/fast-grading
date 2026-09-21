"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Save } from "lucide-react";

interface Settings {
  principal_name: string; phone: string; email: string; address: string; country_code: string; report_footer: string; approval_mode: "self" | "other";
}
const EMPTY: Settings = { principal_name: "", phone: "", email: "", address: "", country_code: "961", report_footer: "", approval_mode: "self" };
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// معلومات المدرسة: كل ما يتغيّر من مدرسة لأخرى في مكان واحد (تظهر على الشهادات والرسائل وتضبط الإرسال).
export default function SchoolSettingsPanel({ accountId, appUser, showMessaging, onNavigate }: {
  accountId: string; appUser: AppUser; showMessaging: boolean; onNavigate: (section: string) => void;
}) {
  const [name, setName] = useState("");
  const [s, setS] = useState<Settings>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
      supabase.from("school_settings").select("*").eq("account_id", accountId).maybeSingle(),
    ]).then(([a, st]) => {
      setName(a.data?.display_name ?? "");
      const d: any = st.data;
      if (d) setS({
        principal_name: d.principal_name ?? "", phone: d.phone ?? "", email: d.email ?? "", address: d.address ?? "",
        country_code: d.country_code ?? "961", report_footer: d.report_footer ?? "", approval_mode: d.approval_mode ?? "self",
      });
    });
  }, [accountId]);

  const set = (k: keyof Settings, v: string) => setS((p) => ({ ...p, [k]: v }));

  async function save() {
    setError(null); setMessage(null);
    if (!name.trim()) return setError("اسم المدرسة مطلوب");
    if (!/^\d{1,4}$/.test(s.country_code)) return setError("رمز الدولة أرقام فقط (مثلاً 961)");
    setSaving(true);
    const { error: e1 } = await supabase.rpc("update_school_name", { p_name: name });
    const payload = {
      account_id: accountId, principal_name: s.principal_name || null, phone: s.phone || null, email: s.email || null, address: s.address || null,
      country_code: s.country_code, report_footer: s.report_footer || null, approval_mode: s.approval_mode, updated_at: new Date().toISOString(),
    };
    const { error: e2 } = await supabase.from("school_settings").upsert(payload, { onConflict: "account_id" });
    setSaving(false);
    const err = e1 ?? e2;
    if (err) return setError(err.message.includes("row-level security") || err.message.includes("صلاحية") ? "ليس لديك صلاحية تعديل إعدادات المدرسة" : err.message);
    setMessage("حُفظت معلومات المدرسة");
  }

  const field = (label: string, k: keyof Settings, ph = "", w = 320) => (
    <div><label style={lbl}>{label}</label>
      <input className="input" style={{ maxWidth: w }} value={s[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></div>
  );

  const checklist: { text: string; go?: string }[] = [
    { text: "اسم المدرسة ورمز الدولة والبيانات الأعلى (هذه الصفحة)" },
    { text: "المواد والمراحل", go: "subjects" },
    { text: "الهيكل الأكاديمي: السنة والفصول وبنود التقييم وأوزانها", go: "academic" },
    { text: "حد النجاح (سياسة العلامات)", go: "gradingPolicy" },
    { text: "الصفوف ثم الطلاب (أو الاستيراد الجماعي)", go: "classSections" },
    { text: "دعوة المستخدمين وإسناد الأساتذة", go: "users" },
  ];

  return (
    <div>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div><label style={lbl}>اسم المدرسة (يظهر على الشهادات والرسائل)</label>
            <input className="input" style={{ maxWidth: 320 }} value={name} onChange={(e) => setName(e.target.value)} /></div>
          {field("اسم المدير/ة", "principal_name")}
          {field("هاتف المدرسة", "phone", "", 200)}
          {field("بريد المدرسة", "email", "", 260)}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
          {field("العنوان", "address", "", 420)}
          <div><label style={lbl}>رمز الدولة لأرقام أولياء الأمور</label>
            <input className="input" style={{ width: 100 }} value={s.country_code} onChange={(e) => set("country_code", e.target.value.replace(/\D/g, ""))} />
            <div style={{ fontSize: "0.72rem", color: "var(--steel)", marginTop: 3 }}>لبنان 961، سوريا 963، الأردن 962، السعودية 966</div></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={lbl}>تذييل الشهادة (اختياري)</label>
          <textarea className="input" rows={2} style={{ width: "100%", maxWidth: 620 }} value={s.report_footer} onChange={(e) => set("report_footer", e.target.value)} />
        </div>

        {showMessaging && (
          <div style={{ marginTop: 14 }}>
            <label style={lbl}>اعتماد رسائل أولياء الأمور قبل إرسالها</label>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              <input type="radio" checked={s.approval_mode === "self"} onChange={() => set("approval_mode", "self")} /> المُعِدّ يراجع ويعتمد بنفسه (مراجعة إلزامية قبل الإرسال)
            </label>
            <label style={{ display: "block", fontSize: "0.85rem" }}>
              <input type="radio" checked={s.approval_mode === "other"} onChange={() => set("approval_mode", "other")} /> يجب أن يعتمدها شخص آخر يملك صلاحية «اعتماد الرسائل» (مثل الناظر)
            </label>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-gold" disabled={saving} onClick={save}><Save size={14} /> {saving ? "جارٍ الحفظ..." : "حفظ"}</button>
        </div>
      </div>

      <div className="card" style={{ padding: "1rem 1.1rem" }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>قائمة تهيئة مدرسة جديدة</h3>
        <ol style={{ margin: 0, paddingInlineStart: 20, lineHeight: 2, fontSize: "0.88rem" }}>
          {checklist.map((c, i) => (
            <li key={i}>{c.text}{c.go && <> — <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(c.go!); }}>افتح</a></>}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
