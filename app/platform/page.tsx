"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface School { id: string; display_name: string; account_type: string; created_at: string; users: number; students: number; enabled_features: string[] }
const FEATURE_LABEL: Record<string, string> = { whatsapp_notifications: "مراسلات واتساب" };
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// لوحة مالك المنصة: المدارس، إنشاء مدرسة جديدة مع مديرها الأول، وتفعيل/إيقاف الإضافات لكل مدرسة.
// الوصول لمن هو في platform_admins فقط، والتنفيذ عبر Edge Function تتحقق من ذلك بنفسها.
export default function PlatformPage() {
  const [state, setState] = useState<"loading" | "denied" | "ok">("loading");
  const [schools, setSchools] = useState<School[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [withFeatures, setWithFeatures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body: { action: "list" } });
    if (e || data?.error) { setState("denied"); return; }
    setSchools(data.schools ?? []); setFeatures(data.features ?? []); setState("ok");
  }
  useEffect(() => { load(); }, []);

  async function createSchool() {
    setError(null); setMessage(null); setBusy(true);
    const { data, error: e } = await supabase.functions.invoke("platform-admin", {
      body: { action: "create_school", name, admin_name: adminName, admin_email: adminEmail, features: withFeatures, redirect_to: `${window.location.origin}/` },
    });
    setBusy(false);
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر الإنشاء");
    setMessage(data.message); setName(""); setAdminName(""); setAdminEmail(""); setWithFeatures([]); load();
  }
  async function toggle(s: School, key: string) {
    const on = !s.enabled_features.includes(key);
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body: { action: "set_feature", account_id: s.id, feature_key: key, enabled: on } });
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر التغيير");
    setError(null); load();
  }

  if (state === "loading") return <p style={{ padding: 24, color: "var(--steel)" }}>جارٍ التحميل...</p>;
  if (state === "denied") return <p style={{ padding: 24, color: "var(--steel)" }}>هذه الصفحة لمالك المنصة فقط. <a href="/dashboard">العودة للوحة التحكم</a></p>;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "1.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: "var(--indigo)" }}>لوحة المنصة</h2>
        <a href="/dashboard">← لوحة التحكم</a>
      </div>
      <div className="grade-underline" style={{ margin: "8px 0 18px" }} />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 18 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>إضافة مدرسة جديدة</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={lbl}>اسم المدرسة</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label style={lbl}>اسم مدير المدرسة</label><input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></div>
          <div><label style={lbl}>بريد المدير (تصله دعوة)</label><input className="input" dir="ltr" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></div>
        </div>
        <div style={{ margin: "10px 0" }}>
          {features.map((f) => (
            <label key={f} style={{ marginInlineEnd: 16, fontSize: "0.85rem" }}>
              <input type="checkbox" checked={withFeatures.includes(f)} onChange={() => setWithFeatures((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))} /> تفعيل «{FEATURE_LABEL[f] ?? f}»
            </label>
          ))}
        </div>
        <button className="btn btn-gold" disabled={busy || !name.trim() || !adminName.trim() || !adminEmail.trim()} onClick={createSchool}>{busy ? "جارٍ الإنشاء..." : "إنشاء المدرسة وإرسال الدعوة"}</button>
        <p style={{ fontSize: "0.78rem", color: "var(--steel)", marginBottom: 0 }}>يُنشأ حساب المدرسة ومديرها الأول بكامل صلاحيات الإدارة، وتصله دعوة بالبريد لتعيين كلمة المرور (تتطلب SMTP مخصصاً في Supabase).</p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>المدرسة</th><th>المستخدمون</th><th>الطلاب</th><th>أُنشئت</th>{features.map((f) => <th key={f}>{FEATURE_LABEL[f] ?? f}</th>)}</tr></thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 700 }}>{s.display_name}</td><td>{s.users}</td><td>{s.students}</td><td>{new Date(s.created_at).toLocaleDateString("ar")}</td>
                {features.map((f) => (
                  <td key={f}><input type="checkbox" checked={s.enabled_features.includes(f)} onChange={() => toggle(s, f)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
