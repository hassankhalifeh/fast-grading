"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, AssessmentItem, GradingOverride, OverrideScope, OverrideTarget, TermRow } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { useTableKit } from "@/lib/tablekit";

const OVERRIDE_COLUMNS = [{ key: "scope_text", label: "النطاق" }, { key: "who", label: "يخص" }, { key: "target_text", label: "الهدف" }, { key: "value_text", label: "الوزن" }, { key: "note_text", label: "ملاحظة" }];

interface Named { id: string; name: string }

const SCOPE_LABEL: Record<OverrideScope, string> = {
  school: "كل المدرسة",
  stage: "مرحلة",
  class: "صف",
  subject: "مادة",
  class_subject: "صف + مادة",
};
const TARGET_LABEL: Record<OverrideTarget, string> = {
  item_weight: "وزن بند التقييم",
  term_weight: "وزن الفصل",
  exam_weight: "وزن امتحان ضمن بنده",
};

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

export default function WeightsPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [tab, setTab] = useState<"stage" | "custom">("stage");
  const [stages, setStages] = useState<Named[]>([]);
  const [classes, setClasses] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [exams, setExams] = useState<Named[]>([]);
  const [overrides, setOverrides] = useState<GradingOverride[]>([]);
  const [stageId, setStageId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [scope, setScope] = useState<OverrideScope>("class");
  const [target, setTarget] = useState<OverrideTarget>("item_weight");
  const [fStage, setFStage] = useState("");
  const [fClass, setFClass] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [fValue, setFValue] = useState("");
  const [fNote, setFNote] = useState("");

  async function load() {
    const [st, cl, su, te, it, ex, ov] = await Promise.all([
      supabase.from("stages").select("id, stage_name").eq("account_id", accountId).order("order_index"),
      supabase.from("class_sections").select("id, name").eq("account_id", accountId),
      supabase.from("subjects").select("id, name").eq("account_id", accountId),
      supabase.from("terms").select("*").eq("account_id", accountId).order("order_index"),
      supabase.from("assessment_items").select("*").eq("account_id", accountId).order("order_index"),
      supabase.from("exams").select("id, exam_name").eq("account_id", accountId),
      supabase.from("grading_overrides").select("*").eq("account_id", accountId),
    ]);
    const stageList = (st.data ?? []).map((s: any) => ({ id: s.id, name: s.stage_name }));
    setStages(stageList);
    setClasses((cl.data ?? []) as Named[]);
    setSubjects((su.data ?? []) as Named[]);
    setTerms((te.data ?? []) as TermRow[]);
    setItems((it.data ?? []) as AssessmentItem[]);
    setExams((ex.data ?? []).map((e: any) => ({ id: e.id, name: e.exam_name })));
    setOverrides((ov.data ?? []) as GradingOverride[]);
    setStageId((cur) => cur || stageList[0]?.id || "");
  }
  useEffect(() => { load(); }, [accountId]);

  function fail(m: string) { setMessage(null); setError(m.includes("row-level security") ? "ليس لديك صلاحية تعديل الأوزان بهذا النطاق" : m.includes("duplicate") ? "يوجد تجاوز مماثل لنفس النطاق والهدف — عدّله أو احذفه" : m); }
  function ok(m: string) { setError(null); setMessage(m); }

  function stageOverride(tg: OverrideTarget, id: string) {
    return overrides.find((o) => o.scope === "stage" && o.stage_id === stageId && o.target === tg &&
      (tg === "item_weight" ? o.item_id === id : o.term_id === id));
  }

  async function setStageWeight(tg: OverrideTarget, id: string, value: string) {
    const existing = stageOverride(tg, id);
    if (value === "") {
      if (existing) {
        const { error: err } = await supabase.from("grading_overrides").delete().eq("id", existing.id);
        if (err) return fail(err.message);
      }
    } else if (existing) {
      const { error: err } = await supabase.from("grading_overrides").update({ value: Number(value), updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (err) return fail(err.message);
    } else {
      const { error: err } = await supabase.from("grading_overrides").insert({
        account_id: accountId, scope: "stage", stage_id: stageId, target: tg, value: Number(value), created_by: appUser.id,
        ...(tg === "item_weight" ? { item_id: id } : { term_id: id }),
      });
      if (err) return fail(err.message);
    }
    ok("تم الحفظ");
    load();
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!fTarget || fValue === "") return fail("اختر الهدف واكتب القيمة");
    const row: Record<string, any> = {
      account_id: accountId, scope, target, value: Number(fValue), note: fNote || null, created_by: appUser.id,
      stage_id: scope === "stage" ? fStage : null,
      class_section_id: scope === "class" || scope === "class_subject" ? fClass : null,
      subject_id: scope === "subject" || scope === "class_subject" ? fSubject : null,
      term_id: target === "term_weight" ? fTarget : null,
      item_id: target === "item_weight" ? fTarget : null,
      exam_id: target === "exam_weight" ? fTarget : null,
    };
    const { error: err } = await supabase.from("grading_overrides").insert(row);
    if (err) return fail(err.message);
    setFValue(""); setFNote("");
    ok("تمت إضافة التجاوز");
    load();
  }

  async function removeOverride(o: GradingOverride) {
    const { error: err } = await supabase.from("grading_overrides").delete().eq("id", o.id);
    if (err) return fail(err.message);
    ok("تم الحذف");
    load();
  }

  const name = (list: Named[], id: string | null) => list.find((x) => x.id === id)?.name ?? "—";
  const itemLabel = (id: string | null) => {
    const it = items.find((i) => i.id === id);
    return it ? `${terms.find((t) => t.id === it.term_id)?.name ?? ""} — ${it.name}` : "—";
  };
  const overrideRows = useMemo(() => overrides.map((o) => ({
    ...o, scope_text: SCOPE_LABEL[o.scope],
    who: [o.stage_id && name(stages, o.stage_id), o.class_section_id && name(classes, o.class_section_id), o.subject_id && name(subjects, o.subject_id)].filter(Boolean).join(" / ") || "—",
    target_text: `${TARGET_LABEL[o.target]}: ${o.item_id ? itemLabel(o.item_id) : o.term_id ? name(terms as any, o.term_id) : name(exams, o.exam_id)}`,
    value_text: `${o.value}${o.value === 0 ? " (غير مفعّل)" : ""}`, note_text: o.note ?? "",
  })), [overrides, stages, classes, subjects, terms, exams, items]);
  const overrideTk = useTableKit(overrideRows, OVERRIDE_COLUMNS);

  const targetOptions: { value: string; label: string }[] =
    target === "item_weight" ? items.map((i) => ({ value: i.id, label: itemLabel(i.id) }))
    : target === "term_weight" ? terms.map((t) => ({ value: t.id, label: t.name }))
    : exams.map((x) => ({ value: x.id, label: x.name }));

  const banner = (
    <>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", margin: "0 0 10px" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", margin: "0 0 10px" }}>{message}</p>}
    </>
  );

  const tabBtn = (id: "stage" | "custom", label: string) => (
    <button onClick={() => setTab(id)} className="btn"
      style={{ background: tab === id ? "var(--indigo)" : "white", color: tab === id ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>
      {label}
    </button>
  );

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        القيم الافتراضية بتجي من "الهيكل الأكاديمي". هون بتعدّلها لمرحلة أو صف أو مادة. الأخص يغلب الأعم:
        صف+مادة ← صف ← مادة ← مرحلة ← المدرسة. اترك الخانة فاضية لاستخدام الافتراضي، و<strong>0</strong> يعني البند غير مفعّل.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {tabBtn("stage", "حسب المرحلة")}
        {tabBtn("custom", "تجاوز خاص (صف / مادة / امتحان)")}
      </div>
      {banner}

      {tab === "stage" && (
        stages.length === 0 ? <p style={{ color: "var(--steel)" }}>أضف مرحلة من قسم "المراحل" أولاً.</p> : (
          <>
            <select className="input" style={{ maxWidth: 280, marginBottom: 14 }} value={stageId} onChange={(e) => setStageId(e.target.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {terms.map((term) => (
              <div key={term.id} className="card" style={{ padding: "1rem", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <strong style={{ color: "var(--indigo)" }}>{term.name}</strong>
                  <span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>وزن الفصل — الافتراضي: {term.default_weight ?? "—"}</span>
                  <input type="number" min={0} className="input" style={{ width: 90 }} placeholder="افتراضي"
                    key={`t-${term.id}-${stageId}-${stageOverride("term_weight", term.id)?.value ?? ""}`}
                    defaultValue={stageOverride("term_weight", term.id)?.value ?? ""}
                    onBlur={(e) => e.target.value !== String(stageOverride("term_weight", term.id)?.value ?? "") && setStageWeight("term_weight", term.id, e.target.value)} />
                </div>
                <table className="data-table">
                  <thead><tr><th>البند</th><th>الافتراضي</th><th>لهذه المرحلة</th></tr></thead>
                  <tbody>
                    {items.filter((i) => i.term_id === term.id).map((item) => {
                      const ov = stageOverride("item_weight", item.id);
                      return (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.default_weight ?? "—"}</td>
                          <td>
                            <input type="number" min={0} className="input" style={{ width: 100 }} placeholder="افتراضي"
                              key={`i-${item.id}-${stageId}-${ov?.value ?? ""}`} defaultValue={ov?.value ?? ""}
                              onBlur={(e) => e.target.value !== String(ov?.value ?? "") && setStageWeight("item_weight", item.id, e.target.value)} />
                            {ov?.value === 0 && <span style={{ marginInlineStart: 8, fontSize: "0.8rem", color: "var(--red)" }}>غير مفعّل</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )
      )}

      {tab === "custom" && (
        <>
          <form onSubmit={addCustom} className="card" style={{ padding: "1.1rem", marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div><label style={lbl}>النطاق</label>
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value as OverrideScope)}>
                {Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            {scope === "stage" && <div><label style={lbl}>المرحلة</label>
              <select className="input" value={fStage} onChange={(e) => setFStage(e.target.value)}><option value="">— اختر —</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            {(scope === "class" || scope === "class_subject") && <div><label style={lbl}>الصف</label>
              <select className="input" value={fClass} onChange={(e) => setFClass(e.target.value)}><option value="">— اختر —</option>
                {classes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            {(scope === "subject" || scope === "class_subject") && <div><label style={lbl}>المادة</label>
              <select className="input" value={fSubject} onChange={(e) => setFSubject(e.target.value)}><option value="">— اختر —</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
            <div><label style={lbl}>ماذا نعدّل</label>
              <select className="input" value={target} onChange={(e) => { setTarget(e.target.value as OverrideTarget); setFTarget(""); }}>
                {Object.entries(TARGET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label style={lbl}>الهدف</label>
              <select className="input" value={fTarget} onChange={(e) => setFTarget(e.target.value)}><option value="">— اختر —</option>
                {targetOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><label style={lbl}>الوزن</label>
              <input type="number" min={0} className="input" style={{ width: 90 }} value={fValue} onChange={(e) => setFValue(e.target.value)} /></div>
            <div><label style={lbl}>ملاحظة</label>
              <input className="input" value={fNote} onChange={(e) => setFNote(e.target.value)} /></div>
            <button type="submit" className="btn btn-gold">إضافة</button>
          </form>

          {overrideTk.toolbar}
          <table className="data-table">
            <thead><tr><th>النطاق</th><th>يخص</th><th>الهدف</th><th>الوزن</th><th>ملاحظة</th><th></th></tr></thead>
            <tbody>
              {overrideTk.rows.filter(() => tab === "custom").map((o) => (
                <tr key={o.id}>
                  <td>{o.scope_text}</td>
                  <td>{o.who}</td>
                  <td>{o.target_text}</td>
                  <td>{o.value_text}</td>
                  <td>{o.note_text}</td>
                  <td><button onClick={() => removeOverride(o)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {overrides.length === 0 && <p style={{ color: "var(--steel)", marginTop: 8 }}>لا توجد تجاوزات بعد — الكل يستخدم الأوزان الافتراضية.</p>}
        </>
      )}
    </div>
  );
}
