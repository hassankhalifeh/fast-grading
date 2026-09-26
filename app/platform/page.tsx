"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTableKit } from "@/lib/tablekit";

interface Sub {
  plan_type: string; status: "active" | "suspended"; expires_at: string | null; days_left: number | null;
  sub_status: "active" | "expiring_soon" | "expired" | "suspended"; notes: string | null;
  limits: { max_classes: number; max_students_per_class: number; max_total_students: number; max_buildings: number; max_stages: number };
  usage: { classes: number; buildings: number; stages: number };
}
interface School { id: string; display_name: string; account_type: "solo_teacher" | "school_enterprise" | string; created_at: string; users: number; students: number; enabled_features: string[]; subscription: Sub | null }
interface Viol { id: string; school: string; occurred_at: string; user_name: string | null; context: string; student_name: string | null; matched_terms: string[]; categories: string[]; excerpt: string | null; review_status: string; reviewed_by_name: string | null; review_note: string | null }
interface GTerm { id: string; term: string; category: string; kind: string }

const FEATURE_LABEL: Record<string, string> = { whatsapp_notifications: "مراسلات واتساب" };
const CAT: Record<string, string> = { sexual: "خادش للحياء", profanity: "ألفاظ نابية", insult: "إهانة", threat: "تهديد", other: "أخرى" };
const TYPE_LABEL: Record<string, string> = { solo_teacher: "فردي (معلّم مستقل)", school_enterprise: "مدرسة" };
const SUB_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "نشط", color: "var(--green)" }, expiring_soon: { label: "ينتهي قريباً", color: "var(--gold-dark)" },
  expired: { label: "منتهي", color: "var(--red)" }, suspended: { label: "موقوف", color: "var(--red)" },
};
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const SOLO_DEFAULTS = { max_classes: 6, max_students_per_class: 30, max_total_students: 150, max_buildings: 1, max_stages: 3 };
const SCHOOL_DEFAULTS = { max_classes: 200, max_students_per_class: 100, max_total_students: 5000, max_buildings: 10, max_stages: 20 };
type Limits = typeof SOLO_DEFAULTS;
const SCHOOL_COLUMNS = [{ key: "display_name", label: "الحساب" }, { key: "type_text", label: "النوع" }, { key: "users", label: "المستخدمون" }, { key: "students", label: "الطلاب" }, { key: "sub_text", label: "الاشتراك" }];
const VIOL_COLUMNS = [{ key: "school", label: "المدرسة" }, { key: "user_name", label: "المستخدم" }, { key: "context", label: "السياق" }, { key: "terms_text", label: "الألفاظ" }, { key: "excerpt", label: "النص" }, { key: "review_status", label: "الحالة" }];

function fmtDate(s: string | null) { return s ? new Date(s).toLocaleDateString("ar") : "بلا انتهاء"; }

// لوحة مالك المنصة: الحسابات (فردي/مدرسة) بحدودها وتاريخ انتهائها، إنشاء حساب جديد، تفعيل/إيقاف الإضافات،
// مراجعة مخالفات المحتوى والقاموس العام. الوصول لمن هو في platform_admins فقط؛ التنفيذ عبر Edge Function تتحقق من ذلك بنفسها.
export default function PlatformPage() {
  const [state, setState] = useState<"loading" | "denied" | "ok">("loading");
  const [schools, setSchools] = useState<School[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // نموذج إنشاء حساب
  const [accountType, setAccountType] = useState<"solo_teacher" | "school_enterprise">("school_enterprise");
  const [name, setName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [withFeatures, setWithFeatures] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [limits, setLimits] = useState<Limits>(SCHOOL_DEFAULTS);
  const [planType, setPlanType] = useState("");

  // تحرير حساب قائم
  const [editing, setEditing] = useState<string | null>(null);
  const [editLimits, setEditLimits] = useState<Limits>(SCHOOL_DEFAULTS);
  const [editExpires, setEditExpires] = useState("");
  const [editStatus, setEditStatus] = useState<"active" | "suspended">("active");
  const [editPlan, setEditPlan] = useState("");
  const [editNote, setEditNote] = useState("");

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
  useEffect(() => { setLimits(accountType === "solo_teacher" ? SOLO_DEFAULTS : SCHOOL_DEFAULTS); }, [accountType]);

  async function createAccount() {
    setError(null); setMessage(null); setBusy(true);
    const { data, error: e } = await supabase.functions.invoke("platform-admin", {
      body: {
        action: "create_account", account_type: accountType, name, admin_name: adminName, admin_email: adminEmail,
        features: withFeatures, redirect_to: `${window.location.origin}/`, expires_at: expiresAt || null, limits, plan_type: planType || undefined,
      },
    });
    setBusy(false);
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر الإنشاء");
    setMessage(data.message); setName(""); setAdminName(""); setAdminEmail(""); setWithFeatures([]); setExpiresAt(""); setPlanType(""); load();
  }
  async function toggle(s: School, key: string) {
    const on = !s.enabled_features.includes(key);
    const { data, error: e } = await supabase.functions.invoke("platform-admin", { body: { action: "set_feature", account_id: s.id, feature_key: key, enabled: on } });
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر التغيير");
    setError(null); load();
  }

  function openEdit(s: School) {
    setEditing(s.id);
    setEditLimits(s.subscription ? { ...s.subscription.limits } : (s.account_type === "solo_teacher" ? SOLO_DEFAULTS : SCHOOL_DEFAULTS));
    setEditExpires(s.subscription?.expires_at ? s.subscription.expires_at.slice(0, 10) : "");
    setEditStatus(s.subscription?.status ?? "active");
    setEditPlan(s.subscription?.plan_type ?? "");
    setEditNote(s.subscription?.notes ?? "");
  }
  async function saveEdit(id: string) {
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.functions.invoke("platform-admin", {
      body: { action: "update_account", account_id: id, limits: editLimits, expires_at: editExpires || null, status: editStatus, plan_type: editPlan || undefined, note: editNote },
    });
    setBusy(false);
    if (e || data?.error) return setError(data?.error ?? e?.message ?? "تعذّر الحفظ");
    setMessage("حُفظت حدود الحساب"); setEditing(null); load();
  }

  const limitField = (v: Limits, set: (v: Limits) => void, key: keyof Limits, label: string, width = 90) => (
    <div><label style={lbl}>{label}</label>
      <input className="input" type="number" min={0} style={{ width }} value={v[key]}
        onChange={(e) => set({ ...v, [key]: Math.max(0, Number(e.target.value) || 0) })} /></div>
  );

  // صفوف الجدولين بنصوصها الظاهرة ليعمل عليها البحث والفلترة (الخطافات قبل أي return مبكر)
  const schoolRows = useMemo(() => schools.map((s) => ({
    ...s, type_text: TYPE_LABEL[s.account_type] ?? s.account_type,
    sub_text: `${(s.subscription ? SUB_STATUS[s.subscription.sub_status] : SUB_STATUS.active).label} ${s.subscription ? fmtDate(s.subscription.expires_at) : ""}`.trim(),
  })), [schools]);
  const schoolTk = useTableKit(schoolRows, SCHOOL_COLUMNS);
  const violRows = useMemo(() => viols.map((v) => ({
    ...v, terms_text: `${v.categories.map((c) => CAT[c] ?? c).join(" ")} ${v.matched_terms.join(" ")}`, excerpt: v.excerpt ?? "",
  })), [viols]);
  const violTk = useTableKit(violRows, VIOL_COLUMNS);

  if (state === "loading") return <p style={{ padding: 24, color: "var(--steel)" }}>جارٍ التحميل...</p>;
  if (state === "denied") return <p style={{ padding: 24, color: "var(--steel)" }}>هذه الصفحة لمالك المنصة فقط. <a href="/dashboard">العودة للوحة التحكم</a></p>;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "1.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: "var(--indigo)" }}>لوحة المنصة</h2>
        <a href="/dashboard">← لوحة التحكم</a>
      </div>
      <div className="grade-underline" style={{ margin: "8px 0 18px" }} />
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 18 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>إنشاء حساب جديد</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={lbl}>نوع الحساب</label>
            <select className="input" value={accountType} onChange={(e) => setAccountType(e.target.value as any)}>
              <option value="school_enterprise">مدرسة</option>
              <option value="solo_teacher">فردي (معلّم مستقل)</option>
            </select></div>
          <div><label style={lbl}>{accountType === "solo_teacher" ? "اسم الحساب" : "اسم المدرسة"}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label style={lbl}>{accountType === "solo_teacher" ? "اسم المستخدم" : "اسم مدير المدرسة"}</label>
            <input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></div>
          <div><label style={lbl}>البريد (تصله دعوة)</label><input className="input" dir="ltr" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></div>
          <div><label style={lbl}>تنتهي الصلاحية في</label>
            <input className="input" type="date" style={{ width: 150 }} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          <div><label style={lbl}>اسم الباقة (اختياري)</label><input className="input" style={{ width: 160 }} value={planType} placeholder="مثلاً: سنوي 50 طالباً" onChange={(e) => setPlanType(e.target.value)} /></div>
        </div>

        <p style={{ fontSize: "0.8rem", fontWeight: 700, margin: "14px 0 6px" }}>الحدود المسموحة لهذا الحساب</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {limitField(limits, setLimits, "max_classes", "عدد الصفوف")}
          {limitField(limits, setLimits, "max_students_per_class", "طلاب/صف")}
          {limitField(limits, setLimits, "max_total_students", "إجمالي الطلاب", 100)}
          {limitField(limits, setLimits, "max_buildings", "الفروع/المباني")}
          {limitField(limits, setLimits, "max_stages", "المراحل")}
        </div>

        <div style={{ margin: "12px 0" }}>
          {features.map((f) => (
            <label key={f} style={{ marginInlineEnd: 16, fontSize: "0.85rem" }}>
              <input type="checkbox" checked={withFeatures.includes(f)} onChange={() => setWithFeatures((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))} /> تفعيل «{FEATURE_LABEL[f] ?? f}»
            </label>
          ))}
        </div>
        <button className="btn btn-gold" disabled={busy || !name.trim() || !adminName.trim() || !adminEmail.trim()} onClick={createAccount}>{busy ? "جارٍ الإنشاء..." : "إنشاء الحساب وإرسال الدعوة"}</button>
        <p style={{ fontSize: "0.78rem", color: "var(--steel)", marginBottom: 0 }}>
          يُنشأ الحساب ومستخدمه الأول بكامل صلاحيات الإدارة، وتصله دعوة بالبريد لتعيين كلمة المرور (تتطلب SMTP مخصصاً في Supabase). الحدود تُفرض في قاعدة البيانات فوراً.
        </p>
      </div>

      {schoolTk.toolbar}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>الحساب</th><th>النوع</th><th>المستخدمون</th><th>الطلاب</th><th>الاشتراك</th>{features.map((f) => <th key={f}>{FEATURE_LABEL[f] ?? f}</th>)}<th></th></tr></thead>
          <tbody>
            {schoolTk.rows.map((s) => {
              const st = s.subscription ? SUB_STATUS[s.subscription.sub_status] : SUB_STATUS.active;
              return (
                <Fragment key={s.id}>
                  <tr>
                    <td style={{ fontWeight: 700 }}>{s.display_name}</td>
                    <td style={{ fontSize: "0.82rem" }}>{TYPE_LABEL[s.account_type] ?? s.account_type}</td>
                    <td>{s.users}</td><td>{s.students}</td>
                    <td style={{ fontSize: "0.8rem" }}>
                      <b style={{ color: st.color }}>{st.label}</b>
                      {s.subscription && (
                        <div style={{ color: "var(--steel)" }}>
                          {fmtDate(s.subscription.expires_at)}{s.subscription.days_left !== null && s.subscription.days_left >= 0 && ` (${s.subscription.days_left} يوم)`}
                          <br />صفوف {s.subscription.usage.classes}/{s.subscription.limits.max_classes}
                        </div>
                      )}
                    </td>
                    {features.map((f) => (
                      <td key={f}><input type="checkbox" checked={s.enabled_features.includes(f)} onChange={() => toggle(s, f)} /></td>
                    ))}
                    <td><button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => (editing === s.id ? setEditing(null) : openEdit(s))}>{editing === s.id ? "إغلاق" : "تعديل الحدود"}</button></td>
                  </tr>
                  {editing === s.id && (
                    <tr>
                      <td colSpan={6 + features.length} style={{ background: "var(--fog)" }}>
                        <div style={{ padding: "10px 4px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                          {limitField(editLimits, setEditLimits, "max_classes", "عدد الصفوف")}
                          {limitField(editLimits, setEditLimits, "max_students_per_class", "طلاب/صف")}
                          {limitField(editLimits, setEditLimits, "max_total_students", "إجمالي الطلاب", 100)}
                          {limitField(editLimits, setEditLimits, "max_buildings", "الفروع/المباني")}
                          {limitField(editLimits, setEditLimits, "max_stages", "المراحل")}
                          <div><label style={lbl}>تنتهي الصلاحية في</label>
                            <input className="input" type="date" style={{ width: 150 }} value={editExpires} onChange={(e) => setEditExpires(e.target.value)} /></div>
                          <div><label style={lbl}>الحالة</label>
                            <select className="input" value={editStatus} onChange={(e) => setEditStatus(e.target.value as any)}>
                              <option value="active">نشط</option><option value="suspended">موقوف يدوياً</option>
                            </select></div>
                          <div><label style={lbl}>اسم الباقة</label><input className="input" style={{ width: 160 }} value={editPlan} onChange={(e) => setEditPlan(e.target.value)} /></div>
                          <div><label style={lbl}>ملاحظة داخلية</label><input className="input" style={{ width: 200 }} value={editNote} onChange={(e) => setEditNote(e.target.value)} /></div>
                          <button className="btn btn-gold" disabled={busy} onClick={() => saveEdit(s.id)}>حفظ</button>
                        </div>
                        <p style={{ margin: "0 0 8px 4px", fontSize: "0.75rem", color: "var(--steel)" }}>اترك «تنتهي الصلاحية» فارغاً لحساب بلا تاريخ انتهاء. تُفرض الحدود فوراً في قاعدة البيانات لكل عمليات الحساب اللاحقة.</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: "22px 0 8px", color: "var(--indigo)" }}>مخالفات المحتوى (كل المدارس)</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button className="btn btn-secondary" onClick={() => setVFilter("open")} style={{ fontWeight: vFilter === "open" ? 800 : 400 }}>بانتظار المراجعة</button>
        <button className="btn btn-secondary" onClick={() => setVFilter("all")} style={{ fontWeight: vFilter === "all" ? 800 : 400 }}>الكل</button>
      </div>
      {viols.length === 0 ? <p style={{ color: "var(--steel)" }}>لا توجد مخالفات.</p> : (
        <>
        {violTk.toolbar}
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>الوقت</th><th>المدرسة</th><th>المستخدم</th><th>السياق</th><th>الألفاظ</th><th>النص</th><th>الحالة</th><th>مراجعة</th></tr></thead>
            <tbody>
              {violTk.rows.map((v) => (
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
        </>
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
