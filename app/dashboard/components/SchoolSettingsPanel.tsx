"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Save } from "lucide-react";

interface Settings {
  principal_name: string; phone: string; email: string; address: string; country_code: string; report_footer: string; approval_mode: "self" | "other"; logo_path: string | null;
}
const EMPTY: Settings = { principal_name: "", phone: "", email: "", address: "", country_code: "961", report_footer: "", approval_mode: "self", logo_path: null };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// معلومات المدرسة: كل ما يتغيّر من مدرسة لأخرى في مكان واحد (تظهر على الشهادات والرسائل وتضبط الإرسال).
export default function SchoolSettingsPanel({ accountId, appUser, showMessaging, onNavigate }: {
  accountId: string; appUser: AppUser; showMessaging: boolean; onNavigate: (section: string) => void;
}) {
  const [name, setName] = useState("");
  const [s, setS] = useState<Settings>(EMPTY);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refreshLogoUrl(path: string | null) {
    setLogoUrl(path ? supabase.storage.from("school-logos").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}` : null);
  }

  useEffect(() => {
    Promise.all([
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
      supabase.from("school_settings").select("*").eq("account_id", accountId).maybeSingle(),
    ]).then(([a, st]) => {
      setName(a.data?.display_name ?? "");
      const d: any = st.data;
      if (d) {
        setS({
          principal_name: d.principal_name ?? "", phone: d.phone ?? "", email: d.email ?? "", address: d.address ?? "",
          country_code: d.country_code ?? "961", report_footer: d.report_footer ?? "", approval_mode: d.approval_mode ?? "self", logo_path: d.logo_path ?? null,
        });
        refreshLogoUrl(d.logo_path ?? null);
      }
    });
  }, [accountId]);

  async function uploadLogo(file: File) {
    setError(null); setMessage(null);
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) return setError("الصيغ المقبولة: PNG أو JPG أو WEBP أو SVG");
    if (file.size > MAX_LOGO_BYTES) return setError("حجم الصورة أكبر من 2 ميغابايت");
    setUploadingLogo(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `${accountId}/logo.${ext}`;
    const { error: upErr } = await supabase.storage.from("school-logos").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploadingLogo(false); return setError("تعذّر رفع الشعار: " + upErr.message); }
    const { error: dbErr } = await supabase.from("school_settings").upsert({ account_id: accountId, logo_path: path, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
    setUploadingLogo(false);
    if (dbErr) return setError("رُفعت الصورة لكن تعذّر حفظها: " + dbErr.message);
    set("logo_path", path);
    refreshLogoUrl(path);
    setMessage("حُفظ شعار المدرسة");
  }

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

  const field = (label: string, k: "principal_name" | "phone" | "email" | "address" | "report_footer", ph = "", w = 320) => (
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
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <label style={lbl}>شعار المدرسة (يظهر في الصفحة الرئيسية)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, border: "1px solid var(--fog-dark)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "var(--fog)" }}>
                {logoUrl ? <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: "0.7rem", color: "var(--steel)" }}>بلا شعار</span>}
              </div>
              <label className="btn btn-secondary" style={{ cursor: uploadingLogo ? "default" : "pointer", opacity: uploadingLogo ? 0.6 : 1, fontSize: "0.82rem" }}>
                {uploadingLogo ? "جارٍ الرفع..." : "رفع / تغيير الشعار"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploadingLogo}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadLogo(f); }} style={{ display: "none" }} />
              </label>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--steel)", marginTop: 3 }}>PNG أو JPG أو WEBP أو SVG، حتى 2 ميغابايت</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div><label style={lbl}>اسم المدرسة (يظهر على الشهادات والرسائل والصفحة الرئيسية)</label>
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
