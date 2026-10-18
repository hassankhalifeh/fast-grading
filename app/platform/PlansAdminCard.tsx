"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Plan {
  id: string; key: string; name_ar: string; description: string | null; account_type: "school_enterprise" | "solo_teacher" | null;
  class_limit: number; students_per_class: number; total_students: number; max_buildings: number; max_stages: number;
  features: string[]; duration_days: number | null; is_active: boolean; sort_order: number;
}

const TYPE_LABEL: Record<string, string> = { school_enterprise: "مدرسة", solo_teacher: "فردي" };
const lbl: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "var(--steel)", marginBottom: 3 };

const EMPTY: Plan = {
  id: "", key: "", name_ar: "", description: "", account_type: "school_enterprise", class_limit: 200, students_per_class: 100,
  total_students: 5000, max_buildings: 10, max_stages: 20, features: [], duration_days: null, is_active: true, sort_order: 100,
};

// كتالوج الباقات: يعرّفها مالك المنصة هنا (حدود + إضافات + مدة)، ثم تُختار عند إنشاء حساب أو تُطبَّق على حساب قائم.
// بلا أسعار ولا دفع عمداً: الباقة وصف لما يحصل عليه الحساب. RLS يحصر القراءة والكتابة بمالك المنصة.
export default function PlansAdminCard({ plans, features, featureLabel, onChanged }: {
  plans: Plan[]; features: string[]; featureLabel: Record<string, string>; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Plan | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function startNew() { setIsNew(true); setErr(null); setOk(null); setEditing({ ...EMPTY, sort_order: (plans[plans.length - 1]?.sort_order ?? 0) + 10 }); }
  function startEdit(p: Plan) { setIsNew(false); setErr(null); setOk(null); setEditing({ ...p }); }

  async function save() {
    if (!editing) return;
    setErr(null); setOk(null);
    if (isNew && !/^[a-z0-9_-]{2,40}$/.test(editing.key)) return setErr("المعرّف: حروف إنجليزية صغيرة وأرقام و - و _ (2 إلى 40)");
    if (!editing.name_ar.trim()) return setErr("اسم الباقة مطلوب");
    setBusy(true);
    const payload = {
      name_ar: editing.name_ar.trim(), description: editing.description?.trim() || null, account_type: editing.account_type,
      class_limit: editing.class_limit, students_per_class: editing.students_per_class, total_students: editing.total_students,
      max_buildings: editing.max_buildings, max_stages: editing.max_stages, features: editing.features,
      duration_days: editing.duration_days && editing.duration_days > 0 ? editing.duration_days : null,
      is_active: editing.is_active, sort_order: Number(editing.sort_order) || 0,
    };
    const { error } = isNew
      ? await supabase.from("plans").insert({ key: editing.key, ...payload })
      : await supabase.from("plans").update(payload).eq("id", editing.id);
    setBusy(false);
    if (error) return setErr(error.message.includes("duplicate") ? "هذا المعرّف مستعمل لباقة أخرى" : error.message);
    setOk("حُفظت الباقة"); setEditing(null); setIsNew(false); onChanged();
  }

  const num = (key: keyof Plan, label: string, width = 90) => editing && (
    <div><label style={lbl}>{label}</label>
      <input className="input" type="number" min={0} style={{ width }} value={editing[key] as number}
        onChange={(e) => setEditing({ ...editing, [key]: Math.max(0, Number(e.target.value) || 0) })} /></div>
  );

  return (
    <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>كتالوج الباقات</h3>
        {!editing && <button className="btn btn-secondary" style={{ marginInlineStart: "auto", fontSize: "0.78rem", padding: "4px 12px" }} onClick={startNew}>+ باقة جديدة</button>}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "var(--steel)" }}>
        باقات جاهزة (حدود + إضافات + مدة) تُختار عند إنشاء حساب أو تُطبَّق على حساب قائم من «تعديل الحدود». لا أسعار هنا: الدفع مؤجَّل لما بعد الإطلاق.
      </p>
      {ok && <p style={{ color: "var(--green)", fontSize: "0.85rem", margin: "0 0 8px" }}>{ok}</p>}

      {!editing ? (
        <table className="data-table" style={{ fontSize: "0.82rem" }}>
          <thead><tr><th>الباقة</th><th>المعرّف</th><th>النوع</th><th>الحدود (صفوف / طلاب-صف / إجمالي / مبانٍ / مراحل)</th><th>الإضافات</th><th>المدة</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 700 }}>{p.name_ar}{p.description && <div style={{ fontWeight: 400, color: "var(--steel)" }}>{p.description}</div>}</td>
                <td dir="ltr" style={{ fontFamily: "var(--font-mono)" }}>{p.key}</td>
                <td>{p.account_type ? TYPE_LABEL[p.account_type] : "أي نوع"}</td>
                <td>{p.class_limit} / {p.students_per_class} / {p.total_students} / {p.max_buildings} / {p.max_stages}</td>
                <td>{p.features.length ? p.features.map((f) => featureLabel[f] ?? f).join("، ") : "—"}</td>
                <td>{p.duration_days ? `${p.duration_days} يوماً` : "بلا انتهاء"}</td>
                <td>{p.is_active ? "مفعّلة" : "موقوفة"}</td>
                <td><button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => startEdit(p)}>تعديل</button></td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={8} style={{ color: "var(--steel)" }}>لا توجد باقات بعد.</td></tr>}
          </tbody>
        </table>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={lbl}>اسم الباقة</label><input className="input" style={{ width: 220 }} value={editing.name_ar} onChange={(e) => setEditing({ ...editing, name_ar: e.target.value })} /></div>
            <div><label style={lbl}>المعرّف (لا يتغيّر بعد الإنشاء)</label><input className="input" dir="ltr" style={{ width: 180 }} disabled={!isNew} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></div>
            <div><label style={lbl}>تصلح لـ</label>
              <select className="input" value={editing.account_type ?? ""} onChange={(e) => setEditing({ ...editing, account_type: (e.target.value || null) as Plan["account_type"] })}>
                <option value="school_enterprise">مدرسة</option><option value="solo_teacher">فردي (معلّم مستقل)</option><option value="">أي نوع</option>
              </select></div>
            <div><label style={lbl}>الوصف</label><input className="input" style={{ width: 300 }} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
            {num("class_limit", "عدد الصفوف")}{num("students_per_class", "طلاب/صف")}{num("total_students", "إجمالي الطلاب", 100)}
            {num("max_buildings", "الفروع/المباني")}{num("max_stages", "المراحل")}
            <div><label style={lbl}>المدة بالأيام (فارغ = بلا انتهاء)</label>
              <input className="input" type="number" min={1} style={{ width: 130 }} value={editing.duration_days ?? ""}
                onChange={(e) => setEditing({ ...editing, duration_days: e.target.value ? Math.max(1, Number(e.target.value) || 1) : null })} /></div>
            {num("sort_order", "الترتيب", 80)}
          </div>
          <div style={{ marginBottom: 12, fontSize: "0.85rem" }}>
            {features.map((f) => (
              <label key={f} style={{ marginInlineEnd: 16 }}>
                <input type="checkbox" checked={editing.features.includes(f)}
                  onChange={() => setEditing({ ...editing, features: editing.features.includes(f) ? editing.features.filter((x) => x !== f) : [...editing.features, f] })} /> تشمل «{featureLabel[f] ?? f}»
              </label>
            ))}
            <label><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> مفعّلة (تظهر عند اختيار باقة)</label>
          </div>
          {err && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-gold" disabled={busy} onClick={save}>{busy ? "جارٍ الحفظ..." : "حفظ"}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(null); setIsNew(false); setErr(null); }}>إلغاء</button>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--steel)", marginBottom: 0 }}>تعديل باقة لا يغيّر الحسابات التي طُبّقت عليها سابقاً؛ يسري على التطبيق اللاحق فقط.</p>
        </div>
      )}
    </div>
  );
}
