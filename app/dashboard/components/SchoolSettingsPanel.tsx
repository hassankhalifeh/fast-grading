"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Save } from "lucide-react";

interface Settings {
  principal_name: string; phone: string; email: string; address: string; country_code: string; report_footer: string; approval_mode: "self" | "other"; background_path: string | null;
}
const EMPTY: Settings = { principal_name: "", phone: "", email: "", address: "", country_code: "961", report_footer: "", approval_mode: "self", background_path: null };
const MAX_BG_BYTES = 4 * 1024 * 1024;
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// معلومات المدرسة: كل ما يتغيّر من مدرسة لأخرى في مكان واحد (تظهر على الشهادات والرسائل وخلف صفحات لوحة التحكم).
export default function SchoolSettingsPanel({ accountId, appUser, showMessaging, onNavigate, onBackgroundChanged }: {
  accountId: string; appUser: AppUser; showMessaging: boolean; onNavigate: (section: string) => void; onBackgroundChanged?: () => void;
}) {
  const [name, setName] = useState("");
  const [s, setS] = useState<Settings>(EMPTY);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refreshBgUrl(path: string | null) {
    setBgUrl(path ? supabase.storage.from("school-logos").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}` : null);
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
          country_code: d.country_code ?? "961", report_footer: d.report_footer ?? "", approval_mode: d.approval_mode ?? "self", background_path: d.background_path ?? null,
        });
        refreshBgUrl(d.background_path ?? null);
      }
    });
  }, [accountId]);

  async function uploadBackground(file: File) {
    setError(null); setMessage(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("الصيغ المقبولة: PNG أو JPG أو WEBP");
    if (file.size > MAX_BG_BYTES) return setError("حجم الصورة أكبر من 4 ميغابايت");
    setUploadingBg(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${accountId}/background.${ext}`;
    const { error: upErr } = await supabase.storage.from("school-logos").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploadingBg(false); return setError("تعذّر رفع الخلفية: " + upErr.message); }
    const { error: dbErr } = await supabase.from("school_settings").upsert({ account_id: accountId, background_path: path, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
    setUploadingBg(false);
    if (dbErr) return setError("رُفعت الصورة لكن تعذّر حفظها: " + dbErr.message);
    set("background_path", path);
    refreshBgUrl(path);
    setMessage("حُفظت خلفية الحساب");
    onBackgroundChanged?.();
  }

  async function removeBackground() {
    if (!s.background_path) return;
    setError(null); setMessage(null);
    setUploadingBg(true);
    const { error: rmErr } = await supabase.storage.from("school-logos").remove([s.background_path]);
    const { error: dbErr } = await supabase.from("school_settings").update({ background_path: null, updated_at: new Date().toISOString() }).eq("account_id", accountId);
    setUploadingBg(false);
    if (rmErr || dbErr) return setError("تعذّرت إزالة الخلفية: " + (rmErr ?? dbErr)!.message);
    set("background_path", "");
    refreshBgUrl(null);
    setMessage("أُزيلت خلفية الحساب — ستُستعمل خلفية المنصة الافتراضية إن وُجدت");
    onBackgroundChanged?.();
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
            <label style={lbl}>خلفية الحساب (تظهر خلف كل صفحات لوحة التحكم)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: 120, height: 68, borderRadius: 10, border: "1px solid var(--fog-dark)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "var(--fog)" }}>
                {bgUrl ? <img src={bgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "0.7rem", color: "var(--steel)" }}>بلا خلفية خاصة</span>}
              </div>
              <label className="btn btn-secondary" style={{ cursor: uploadingBg ? "default" : "pointer", opacity: uploadingBg ? 0.6 : 1, fontSize: "0.82rem" }}>
                {uploadingBg ? "جارٍ..." : "رفع / تغيير الخلفية"}
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingBg}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadBackground(f); }} style={{ display: "none" }} />
              </label>
              {s.background_path && (
                <button type="button" className="btn btn-secondary" style={{ fontSize: "0.82rem", color: "var(--red)" }} disabled={uploadingBg} onClick={removeBackground}>
                  إزالة الخلفية
                </button>
              )}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--steel)", marginTop: 3 }}>PNG أو JPG أو WEBP، حتى 4 ميغابايت. إن لم تضع خلفية خاصة، تُستعمل خلفية المنصة الافتراضية التي يحددها مالك المنصة.</div>
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
