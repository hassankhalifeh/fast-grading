"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface School { id: string; display_name: string; account_type: string; created_at: string; users: number; students: number; enabled_features: string[] }
const FEATURE_LABEL: Record<string, string> = { whatsapp_notifications: "مراسلات واتساب" };
interface Viol { id: string; school: string; occurred_at: string; user_name: string | null; context: string; student_name: string | null; matched_terms: string[]; categories: string[]; excerpt: string | null; review_status: string; reviewed_by_name: string | null; review_note: string | null }
interface GTerm { id: string; term: string; category: string; kind: string }
const CAT: Record<string, string> = { sexual: "خادش للحياء", profanity: "ألفاظ نابية", insult: "إهانة", threat: "تهديد", other: "أخرى" };
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
  const [viols, setViols] = useState<Viol[]>([]);
  const [vFilter, setVFilter] = useState<"open" | "all">("open");
  const [vNotes, setVNotes] = useState<Record<string, string>>({});
  const [gterms, setGterms] = useState<GTerm[]>([]);
  const [showTerms, setShowTerms] = useState(false);
  const [gTerm, setGTerm] = useState("");
  const [gCat, setGCat] = useState("insult");
  const [gKind, setGKind] = useState<"block" | "allow">("block");

  async function load() {
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body: { action: "list" } });
    if (e || data?.error) { setState("denied"); return; }
    setSchools(data.schools ?? []); setFeatures(data.features ?? []); setState("ok");
  }
  async function loadViols(f = vFilter) {
    const { data } = await supabase.functions.invoke("platform-admin", { body: { action: "violations", status: f } });
    setViols(data?.violations ?? []);
  }
  async function loadTerms() {
    const { data } = await supabase.functions.invoke("platform-admin", { body: { action: "terms_list" } });
    setGterms(data?.terms ?? []);
  }
  async function reviewV(id: string, status: string) {
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body: { action: "review_violation", id, status, note: vNotes[id] ?? "" } });
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّرت المراجعة");
    setError(null); loadViols();
  }
  async function termCall(body: Record<string, unknown>) {
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body });
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر التنفيذ");
    setError(null); setGTerm(""); loadTerms();
  }
  useEffect(() => { load(); loadViols(); }, []);
  useEffect(() => { loadViols(vFilter); }, [vFilter]);

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

      <h3 style={{ margin: "22px 0 8px", color: "var(--indigo)" }}>مخالفات المحتوى (كل المدارس)</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button className="btn btn-secondary" onClick={() => setVFilter("open")} style={{ fontWeight: vFilter === "open" ? 800 : 400 }}>بانتظار المراجعة</button>
        <button className="btn btn-secondary" onClick={() => setVFilter("all")} style={{ fontWeight: vFilter === "all" ? 800 : 400 }}>الكل</button>
      </div>
      {viols.length === 0 ? <p style={{ color: "var(--steel)" }}>لا توجد مخالفات.</p> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>الوقت</th><th>المدرسة</th><th>المستخدم</th><th>السياق</th><th>الألفاظ</th><th>النص</th><th>الحالة</th><th>مراجعة</th></tr></thead>
            <tbody>
              {viols.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontSize: "0.78rem" }}>{new Date(v.occurred_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{v.school}</td><td>{v.user_name ?? "—"}</td><td style={{ fontSize: "0.8rem" }}>{v.context}</td>
                  <td style={{ fontSize: "0.8rem" }}>{v.categories.map((c) => CAT[c] ?? c).join("، ")}<div style={{ color: "var(--red)" }}>{v.matched_terms.join("، ")}</div></td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 280, whiteSpace: "pre-wrap" }}>{v.excerpt}</td>
                  <td style={{ fontSize: "0.8rem" }}>{v.review_status}{v.reviewed_by_name && <div style={{ color: "var(--steel)" }}>{v.reviewed_by_name}</div>}{v.review_note && <div style={{ color: "var(--steel)" }}>{v.review_note}</div>}</td>
                  <td>
                    <input className="input" style={{ width: 130, marginBottom: 4 }} placeholder="ملاحظة" value={vNotes[v.id] ?? ""} onChange={(e) => setVNotes((p) => ({ ...p, [v.id]: e.target.value }))} />
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "2px 8px" }} onClick={() => reviewV(v.id, "confirmed")}>تأكيد</button>
                      <button className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "2px 8px" }} onClick={() => reviewV(v.id, "dismissed")}>رفض</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ margin: "22px 0 8px", color: "var(--indigo)" }}>قاموس الألفاظ العام</h3>
      <button className="btn btn-secondary" onClick={() => { setShowTerms((x) => !x); if (!showTerms) loadTerms(); }}>{showTerms ? "إخفاء" : "عرض وتعديل القاموس العام"}</button>
      {showTerms && (
        <div className="card" style={{ padding: "1rem 1.1rem", marginTop: 8 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={lbl}>المصطلح</label><input className="input" value={gTerm} onChange={(e) => setGTerm(e.target.value)} /></div>
            <div><label style={lbl}>النوع</label><select className="input" value={gKind} onChange={(e) => setGKind(e.target.value as "block" | "allow")}><option value="block">محجوب</option><option value="allow">مسموح (استثناء)</option></select></div>
            <div><label style={lbl}>التصنيف</label><select className="input" value={gCat} onChange={(e) => setGCat(e.target.value)}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <button className="btn btn-gold" disabled={!gTerm.trim()} onClick={() => termCall({ action: "terms_add", term: gTerm, category: gCat, kind: gKind })}>إضافة</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {gterms.map((t) => (
              <span key={t.id} style={{ border: "1px solid var(--fog-dark)", borderRadius: 14, padding: "2px 10px", fontSize: "0.8rem" }}>
                {t.term} <span style={{ color: "var(--steel)" }}>({t.kind === "allow" ? "مسموح" : CAT[t.category] ?? t.category})</span>{" "}
                <button onClick={() => termCall({ action: "terms_remove", id: t.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
