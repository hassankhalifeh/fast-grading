"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AssessmentItem, AssessmentKind, TermRow } from "@/lib/types";
import { Trash2, Plus } from "lucide-react";

const KIND_LABEL: Record<AssessmentKind, string> = {
  coursework: "سعي",
  term_exam: "امتحان فصل",
  other: "آخر",
};

const labelStyle = { display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 5 } as const;

// الأوزان نسبية: النسبة الفعلية = الوزن ÷ مجموع أوزان الموجود. فما في داعي يكون المجموع 100 بالضبط.
function pct(weight: number | null, all: (number | null)[]) {
  const sum = all.reduce<number>((s, w) => s + (w ?? 0), 0);
  if (!sum || weight === null) return "—";
  return `${Math.round((weight / sum) * 1000) / 10}%`;
}

export default function AcademicStructurePanel({ accountId }: { accountId: string }) {
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [wYear, setWYear] = useState("");
  const [wTerms, setWTerms] = useState(2);
  const [wCw, setWCw] = useState(2);
  const [wExam, setWExam] = useState(true);
  const [wShare, setWShare] = useState(30);

  const [newItem, setNewItem] = useState<Record<string, { name: string; kind: AssessmentKind; weight: string }>>({});

  async function load() {
    const [t, i] = await Promise.all([
      supabase.from("terms").select("*").eq("account_id", accountId).order("order_index"),
      supabase.from("assessment_items").select("*").eq("account_id", accountId).order("order_index"),
    ]);
    setTerms((t.data ?? []) as TermRow[]);
    setItems((i.data ?? []) as AssessmentItem[]);
    setLoaded(true);
  }
  useEffect(() => { load(); }, [accountId]);

  function fail(msg: string) { setMessage(null); setError(msg); }
  function ok(msg: string) { setError(null); setMessage(msg); }

  async function runWizard(e: React.FormEvent) {
    e.preventDefault();
    const { data, error: err } = await supabase.rpc("setup_academic_structure", {
      p_year_name: wYear || "السنة الدراسية",
      p_terms: wTerms,
      p_coursework_per_term: wCw,
      p_has_term_exam: wExam,
      p_coursework_share: wShare,
    });
    if (err) return fail(err.message);
    ok(String(data));
    load();
  }

  async function saveTermWeight(term: TermRow, value: string) {
    const w = value === "" ? null : Number(value);
    const { error: err } = await supabase.from("terms").update({ default_weight: w }).eq("id", term.id);
    if (err) return fail(err.message);
    ok("تم حفظ وزن الفصل");
    load();
  }

  async function saveItem(item: AssessmentItem, patch: Partial<AssessmentItem>) {
    const { error: err } = await supabase.from("assessment_items").update(patch).eq("id", item.id);
    if (err) return fail(err.message);
    ok("تم الحفظ");
    load();
  }

  async function removeItem(item: AssessmentItem) {
    if (!confirm(`حذف البند "${item.name}"؟`)) return;
    const { error: err } = await supabase.from("assessment_items").delete().eq("id", item.id);
    if (err) return fail(err.message.includes("foreign key") ? "لا يمكن حذف بند مرتبط بامتحانات — انقل الامتحانات لبند آخر أولاً" : err.message);
    ok("تم الحذف");
    load();
  }

  async function addItem(term: TermRow) {
    const v = newItem[term.id];
    if (!v || !v.name) return fail("اكتب اسم البند");
    const order = items.filter((i) => i.term_id === term.id).length + 1;
    const { error: err } = await supabase.from("assessment_items").insert({
      account_id: accountId, term_id: term.id, name: v.name, kind: v.kind, order_index: order,
      default_weight: v.weight === "" ? null : Number(v.weight),
    });
    if (err) return fail(err.message);
    setNewItem((s) => ({ ...s, [term.id]: { name: "", kind: "coursework", weight: "" } }));
    ok("تمت إضافة البند");
    load();
  }

  async function addTerm() {
    const { data: years } = await supabase.from("academic_years").select("id").eq("account_id", accountId).eq("is_current", true).maybeSingle();
    const { error: err } = await supabase.from("terms").insert({
      account_id: accountId, name: `الفصل ${terms.length + 1}`, order_index: terms.length + 1,
      academic_year_id: years?.id ?? null, default_weight: 100 / (terms.length + 1),
    });
    if (err) return fail(err.message);
    ok("تمت إضافة فصل — أضف له بنود التقييم");
    load();
  }

  if (!loaded) return <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p>;

  const banner = (
    <>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", margin: "0 0 12px" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", margin: "0 0 12px" }}>{message}</p>}
    </>
  );

  if (items.length === 0) {
    return (
      <form onSubmit={runWizard} className="card fade-in" style={{ padding: "1.5rem", maxWidth: 520 }}>
        <p style={{ fontSize: "0.9rem", color: "var(--steel)", marginBottom: 16 }}>
          اختر نمط مدرستك وبنولّد لك الفصول وبنود التقييم بأوزان مبدئية متساوية. بتقدر تعدّل كل شي بعدها، وتغيّر النسب لكل مرحلة أو صف من شاشة "المعدلات والأوزان".
        </p>
        <label style={labelStyle}>السنة الدراسية</label>
        <input className="input" style={{ marginBottom: 14 }} value={wYear} placeholder="مثلاً 2026-2027" onChange={(e) => setWYear(e.target.value)} />

        <label style={labelStyle}>عدد الفصول</label>
        <input type="number" min={1} max={6} className="input" style={{ marginBottom: 14 }} value={wTerms} onChange={(e) => setWTerms(e.target.valueAsNumber)} />

        <label style={labelStyle}>عدد السعي في كل فصل (0 إذا لا يوجد)</label>
        <input type="number" min={0} max={6} className="input" style={{ marginBottom: 14 }} value={wCw} onChange={(e) => setWCw(e.target.valueAsNumber)} />

        <label style={{ ...labelStyle, display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={wExam} onChange={(e) => setWExam(e.target.checked)} /> يوجد امتحان في نهاية كل فصل
        </label>

        {wCw > 0 && wExam && (
          <>
            <label style={{ ...labelStyle, marginTop: 14 }}>نسبة السعي من علامة الفصل (%)</label>
            <input type="number" min={1} max={99} className="input" style={{ marginBottom: 14 }} value={wShare} onChange={(e) => setWShare(e.target.valueAsNumber)} />
          </>
        )}
        {banner}
        <button type="submit" className="btn btn-gold" style={{ marginTop: 8 }}>إنشاء الهيكل</button>
      </form>
    );
  }

  const termWeights = terms.map((t) => t.default_weight);

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        الأوزان نسبية: النسبة الفعلية = الوزن ÷ مجموع الأوزان. وتُعدّل لكل مرحلة أو صف أو مادة من شاشة "المعدلات والأوزان".
      </p>
      {banner}
      {terms.map((term) => {
        const termItems = items.filter((i) => i.term_id === term.id);
        const itemWeights = termItems.map((i) => i.default_weight);
        const draft = newItem[term.id] ?? { name: "", kind: "coursework" as AssessmentKind, weight: "" };
        return (
          <div key={term.id} className="card" style={{ padding: "1.1rem", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <strong style={{ color: "var(--indigo)" }}>{term.name}</strong>
              <span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>وزن الفصل من السنة:</span>
              <input type="number" min={0} className="input" style={{ width: 90 }} defaultValue={term.default_weight ?? ""}
                onBlur={(e) => e.target.value !== String(term.default_weight ?? "") && saveTermWeight(term, e.target.value)} />
              <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{pct(term.default_weight, termWeights)}</span>
            </div>

            <table className="data-table">
              <thead><tr><th>البند</th><th>النوع</th><th>الوزن</th><th>النسبة الفعلية</th><th></th></tr></thead>
              <tbody>
                {termItems.map((item) => (
                  <tr key={item.id}>
                    <td><input className="input" defaultValue={item.name}
                      onBlur={(e) => e.target.value && e.target.value !== item.name && saveItem(item, { name: e.target.value })} /></td>
                    <td>
                      <select className="input" value={item.kind} onChange={(e) => saveItem(item, { kind: e.target.value as AssessmentKind })}>
                        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min={0} className="input" style={{ width: 90 }} defaultValue={item.default_weight ?? ""}
                      onBlur={(e) => e.target.value !== String(item.default_weight ?? "") &&
                        saveItem(item, { default_weight: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                    <td style={{ fontWeight: 700 }}>{pct(item.default_weight, itemWeights)}</td>
                    <td><button onClick={() => removeItem(item)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input className="input" style={{ maxWidth: 180 }} placeholder="بند جديد (مثلاً سعي 3)" value={draft.name}
                onChange={(e) => setNewItem((s) => ({ ...s, [term.id]: { ...draft, name: e.target.value } }))} />
              <select className="input" style={{ maxWidth: 130 }} value={draft.kind}
                onChange={(e) => setNewItem((s) => ({ ...s, [term.id]: { ...draft, kind: e.target.value as AssessmentKind } }))}>
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input type="number" min={0} className="input" style={{ maxWidth: 90 }} placeholder="الوزن" value={draft.weight}
                onChange={(e) => setNewItem((s) => ({ ...s, [term.id]: { ...draft, weight: e.target.value } }))} />
              <button onClick={() => addItem(term)} className="btn btn-secondary" style={{ padding: "8px 14px" }}><Plus size={16} /></button>
            </div>
          </div>
        );
      })}
      <button onClick={addTerm} className="btn btn-secondary">+ إضافة فصل</button>
    </div>
  );
}
