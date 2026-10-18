"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { CalendarClock, Plus, Trash2, CheckCheck } from "lucide-react";

type Outcome = "promote" | "repeat" | "graduate" | "left" | "pending";
interface Plan { id: string; from_year_id: string; to_year_name: string; options: { structure: boolean; overrides: boolean; teachers: boolean }; status: "draft" | "applied"; created_at: string; applied_at: string | null; summary: Record<string, number> | null }
interface TargetClass { id: string; plan_id: string; source_class_id: string | null; name: string; sort_order: number }
interface RStudent { id: string; student_id: string; source_class_id: string; target_class_id: string | null; suggested_outcome: Outcome; outcome: Outcome; confirmed: boolean }

const OUTCOME_LABEL: Record<Outcome, string> = { promote: "ترفيع", repeat: "إعادة السنة", graduate: "تخرّج", left: "غادر المدرسة", pending: "بلا قرار" };
const OUTCOME_COLOR: Record<Outcome, string> = { promote: "var(--green)", repeat: "var(--gold-dark)", graduate: "var(--indigo)", left: "var(--steel)", pending: "var(--red)" };

// نفس منطق rollover_next_name في قاعدة البيانات: يزيد أول رقم في الاسم ("الصف 2" → "الصف 3")
function nextName(name: string): string | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : null;
}
function nextYearName(name: string | undefined): string {
  if (!name) return "";
  return name.replace(/\d{4}/g, (y) => String(Number(y) + 1));
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ترحيل السنة الدراسية: يقترح النظام مصير كل طالب بحسب نجاحه، وتراجعه الإدارة (أو من لديه صلاحية إدارة الصفوف) وتؤكد انتساب كل طالب،
// ثم يُعتمد الترحيل دفعة واحدة: سنة جديدة بشعب جديدة، والشعب القديمة تُؤرشف باسم السنة القديمة وتبقى تقاريرها.
export default function RolloverPanel({ accountId, appUser, capabilities }: { accountId: string; appUser: AppUser; capabilities: Set<string> }) {
  const canConfig = capabilities.has("config.manage");
  const [loaded, setLoaded] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentYear, setCurrentYear] = useState<{ id: string; name: string } | null>(null);
  const [classes, setClasses] = useState<TargetClass[]>([]);
  const [students, setStudents] = useState<RStudent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [classNames, setClassNames] = useState<Map<string, string>>(new Map());
  const [yearName, setYearName] = useState("");
  const [opts, setOpts] = useState({ structure: true, overrides: true, teachers: true });
  const [newClass, setNewClass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number | string> | null>(null);

  const draft = plans.find((p) => p.status === "draft") ?? null;

  const load = useCallback(async () => {
    const [{ data: yr }, { data: pl }] = await Promise.all([
      supabase.from("academic_years").select("id, name").eq("account_id", accountId).eq("is_current", true).maybeSingle(),
      supabase.from("rollover_plans").select("*").order("created_at", { ascending: false }),
    ]);
    setCurrentYear(yr ?? null);
    const list = (pl ?? []) as Plan[];
    setPlans(list);
    setYearName((cur) => cur || nextYearName(yr?.name));
    const d = list.find((p) => p.status === "draft");
    if (d) {
      const [cls, sts, stuNames, cNames] = await Promise.all([
        supabase.from("rollover_classes").select("id, plan_id, source_class_id, name, sort_order").eq("plan_id", d.id).order("sort_order"),
        fetchAll<RStudent>((f, t) => supabase.from("rollover_students").select("id, student_id, source_class_id, target_class_id, suggested_outcome, outcome, confirmed").eq("plan_id", d.id).order("id").range(f, t)),
        fetchAll<{ id: string; full_name: string }>((f, t) => supabase.from("students").select("id, full_name").eq("account_id", accountId).order("id").range(f, t)),
        supabase.from("class_sections").select("id, name").eq("account_id", accountId),
      ]);
      setClasses((cls.data ?? []) as TargetClass[]);
      setStudents(sts);
      setNames(new Map(stuNames.map((s) => [s.id, s.full_name])));
      setClassNames(new Map((cNames.data ?? []).map((c: any) => [c.id, c.name])));
    } else { setClasses([]); setStudents([]); }
    setLoaded(true);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Outcome, number> = { promote: 0, repeat: 0, graduate: 0, left: 0, pending: 0 };
    students.forEach((s) => { c[s.outcome]++; });
    return { ...c, unconfirmed: students.filter((s) => !s.confirmed).length, total: students.length };
  }, [students]);
  const ready = counts.pending === 0 && counts.unconfirmed === 0 && classes.length > 0;

  const bySource = useMemo(() => {
    const m = new Map<string, RStudent[]>();
    students.forEach((s) => { m.set(s.source_class_id, [...(m.get(s.source_class_id) ?? []), s]); });
    return [...m.entries()].sort((a, b) => (classNames.get(a[0]) ?? "").localeCompare(classNames.get(b[0]) ?? "", "ar"));
  }, [students, classNames]);

  function fail(msg: string) { setError(msg); setMessage(null); }

  async function start() {
    setError(null); setMessage(null); setBusy(true);
    const { error: e } = await supabase.rpc("create_rollover_plan", { p_year_name: yearName, p_options: opts });
    setBusy(false);
    if (e) return fail(e.message);
    await load();
  }
  async function cancel() {
    if (!draft || !window.confirm("إلغاء خطة الترحيل الحالية؟ تُحذف كل القرارات التي اتُّخذت فيها ولا يتغيّر شيء في بياناتك.")) return;
    setBusy(true);
    const { error: e } = await supabase.from("rollover_plans").delete().eq("id", draft.id);
    setBusy(false);
    if (e) return fail(e.message);
    setMessage("أُلغيت الخطة"); load();
  }
  async function apply() {
    if (!draft) return;
    if (!window.confirm(`اعتماد الترحيل إلى «${draft.to_year_name}»؟\n\n• تُنشأ السنة الجديدة وتصبح الحالية.\n• تُؤرشف الشعب القديمة (باسم السنة القديمة) وتبقى تقاريرها.\n• يُسجَّل كل طالب في شعبته الجديدة.\n\nلا يمكن التراجع عن هذه الخطوة تلقائياً.`)) return;
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc("apply_rollover_plan", { p_plan: draft.id });
    setBusy(false);
    if (e) return fail(e.message);
    setDone(data as Record<string, number | string>);
    load();
  }

  async function patchStudent(id: string, patch: Partial<Pick<RStudent, "outcome" | "target_class_id" | "confirmed">>) {
    setStudents((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch, ...(patch.outcome === "pending" ? { confirmed: false } : {}), ...(patch.outcome === "graduate" || patch.outcome === "left" ? { target_class_id: null } : {}) } : s)));
    const { error: e } = await supabase.from("rollover_students").update(patch).eq("id", id);
    if (e) { fail(e.message); load(); }
  }
  function changeOutcome(s: RStudent, outcome: Outcome) {
    let target = s.target_class_id;
    if (outcome === "repeat") target = classes.find((c) => c.source_class_id === s.source_class_id)?.id ?? target;
    if (outcome === "promote") {
      const nn = nextName(classNames.get(s.source_class_id) ?? "");
      target = (nn && classes.find((c) => c.source_class_id && classNames.get(c.source_class_id) === nn)?.id) || target;
    }
    patchStudent(s.id, { outcome, target_class_id: target });
  }
  async function confirmGroup(sourceId: string) {
    setStudents((cur) => cur.map((s) => (s.source_class_id === sourceId && s.outcome !== "pending" ? { ...s, confirmed: true } : s)));
    if (!draft) return;
    const { error: e } = await supabase.from("rollover_students").update({ confirmed: true }).eq("plan_id", draft.id).eq("source_class_id", sourceId).neq("outcome", "pending");
    if (e) { fail(e.message); load(); }
  }
  async function renameClass(c: TargetClass, name: string) {
    if (!name.trim() || name === c.name) return;
    setClasses((cur) => cur.map((x) => (x.id === c.id ? { ...x, name } : x)));
    const { error: e } = await supabase.from("rollover_classes").update({ name: name.trim() }).eq("id", c.id);
    if (e) { fail(e.message); load(); }
  }
  async function addClass() {
    if (!draft || !newClass.trim()) return;
    const { error: e } = await supabase.from("rollover_classes").insert({ account_id: accountId, plan_id: draft.id, name: newClass.trim(), sort_order: (classes[classes.length - 1]?.sort_order ?? 0) + 1 });
    if (e) return fail(e.message);
    setNewClass(""); load();
  }
  async function removeClass(c: TargetClass) {
    const used = students.filter((s) => s.target_class_id === c.id).length;
    if (!window.confirm(used ? `هذه الشعبة فيها ${used} طالباً؛ سيصبحون بلا شعبة هدف ويلزمك توزيعهم من جديد. متابعة؟` : "حذف هذه الشعبة الهدف؟")) return;
    const { error: e } = await supabase.from("rollover_classes").delete().eq("id", c.id);
    if (e) return fail(e.message);
    load();
  }

  if (!loaded) return <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p>;

  const banner = (
    <>
      {error && <p style={{ color: "var(--red)", fontSize: "0.88rem", margin: "0 0 12px" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.88rem", margin: "0 0 12px" }}>{message}</p>}
    </>
  );

  if (done) {
    return (
      <div className="card" style={{ padding: "1.4rem" }}>
        <p style={{ fontWeight: 800, color: "var(--green)", marginTop: 0 }}>تم الترحيل إلى «{String(done.year)}»</p>
        <p style={{ lineHeight: 2, fontSize: "0.92rem" }}>
          شعب جديدة: <b>{done.classes}</b> · فصول: <b>{done.terms}</b> · بنود تقييم: <b>{done.items}</b> · تجاوزات أوزان: <b>{done.overrides}</b> · إسنادات أساتذة: <b>{done.teachers}</b><br />
          ترفيع: <b>{done.promote}</b> · إعادة السنة: <b>{done.repeat}</b> · تخرّج: <b>{done.graduate}</b> · غادر: <b>{done.left}</b>
        </p>
        <button className="btn btn-gold" onClick={() => window.location.reload()}>تحديث لوحة التحكم</button>
      </div>
    );
  }

  const applied = plans.filter((p) => p.status === "applied");

  return (
    <div>
      {banner}
      {!draft ? (
        <div className="card" style={{ padding: "1.2rem 1.4rem", marginBottom: 18, maxWidth: 640 }}>
          <p style={{ fontWeight: 800, color: "var(--indigo)", marginTop: 0, display: "flex", gap: 8, alignItems: "center" }}><CalendarClock size={18} /> ترحيل السنة الدراسية</p>
          <p style={{ fontSize: "0.88rem", color: "var(--steel)", lineHeight: 1.9 }}>
            السنة الحالية: <b>{currentYear?.name ?? "—"}</b>. عند البدء يقترح النظام نقل كل طالب بحسب نجاحه (الناجح إلى صف السنة التالية، والراسب يعيد سنته)،
            وتراجع الإدارة الاقتراح وتؤكد انتساب كل طالب (قد يكون بعضهم غادر المدرسة) قبل الاعتماد. لا يتغيّر شيء في بياناتك قبل الاعتماد النهائي.
          </p>
          {!canConfig ? <p style={{ fontSize: "0.88rem" }}>لا يوجد ترحيل قيد التحضير. بدء الترحيل من صلاحية إدارة الإعدادات (الناظر العام).</p> : !currentYear ? (
            <p style={{ color: "var(--red)", fontSize: "0.88rem" }}>لا توجد سنة دراسية حالية. أنشئ الهيكل الأكاديمي أولاً من «الهيكل الأكاديمي».</p>
          ) : (
            <>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 6 }}>اسم السنة الجديدة</label>
              <input className="input" style={{ maxWidth: 260, marginBottom: 14 }} value={yearName} onChange={(e) => setYearName(e.target.value)} placeholder="مثلاً 2026-2027" />
              <p style={{ fontSize: "0.82rem", fontWeight: 600, margin: "0 0 6px" }}>ما الذي يُنسخ إلى السنة الجديدة؟</p>
              <label style={{ display: "block", fontSize: "0.86rem", marginBottom: 4 }}><input type="checkbox" checked={opts.structure} onChange={(e) => setOpts({ ...opts, structure: e.target.checked, overrides: e.target.checked && opts.overrides })} /> هيكل الفصول وبنود التقييم وأوزانها الافتراضية</label>
              <label style={{ display: "block", fontSize: "0.86rem", marginBottom: 4, opacity: opts.structure ? 1 : 0.5 }}><input type="checkbox" disabled={!opts.structure} checked={opts.overrides && opts.structure} onChange={(e) => setOpts({ ...opts, overrides: e.target.checked })} /> تجاوزات الأوزان (للفصول وبنود التقييم)</label>
              <label style={{ display: "block", fontSize: "0.86rem", marginBottom: 14 }}><input type="checkbox" checked={opts.teachers} onChange={(e) => setOpts({ ...opts, teachers: e.target.checked })} /> إسناد الأساتذة الأساسيين للشعب والمواد (الأستاذ الثاني يحتاج موافقة جديدة)</label>
              <button className="btn btn-gold" disabled={busy || yearName.trim().length < 3} onClick={start}>{busy ? "جارٍ التحضير..." : "ابدأ تحضير الترحيل"}</button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: 14, borderInlineStart: "4px solid var(--gold)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ color: "var(--indigo)" }}>ترحيل من «{currentYear?.name}» إلى «{draft.to_year_name}»</b>
              <span style={{ fontSize: "0.78rem", color: "var(--steel)" }}>(مسودة: لا يتغيّر شيء قبل الاعتماد)</span>
              {canConfig && <button className="btn btn-secondary" style={{ marginInlineStart: "auto", fontSize: "0.78rem", padding: "4px 12px" }} disabled={busy} onClick={cancel}>إلغاء الخطة</button>}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "0.88rem", lineHeight: 2 }}>
              {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <span key={o} style={{ marginInlineEnd: 14, color: OUTCOME_COLOR[o], fontWeight: 700 }}>{OUTCOME_LABEL[o]}: {counts[o]}</span>)}
              <span style={{ color: "var(--steel)" }}> · المؤكَّد: {counts.total - counts.unconfirmed}/{counts.total}</span>
            </p>
          </div>

          <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: 14 }}>
            <b style={{ color: "var(--indigo)", display: "block", marginBottom: 8 }}>شعب السنة الجديدة</b>
            <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "var(--steel)" }}>كل شعبة قديمة لها شعبة مجدّدة بنفس الاسم؛ عدّل الأسماء كما تريد أو أضف شعباً جديدة. الاقتراح التلقائي يوجّه الناجح إلى شعبة الصف التالي بزيادة الرقم في اسمها؛ فإن لم توجد شعبة للصف التالي يُقترح «تخرّج». إن لم يكن الصف آخر صف عندكم فأضف هنا شعبة للصف التالي ثم غيّر قرار طلابه إلى «ترفيع» واختر لهم الشعبة.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {classes.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input className="input" style={{ width: 150 }} defaultValue={c.name} onBlur={(e) => renameClass(c, e.target.value)} title={c.source_class_id ? `مجدّدة من «${classNames.get(c.source_class_id) ?? ""}»` : "شعبة جديدة"} />
                  <button type="button" onClick={() => removeClass(c)} aria-label="حذف" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--steel)" }}><Trash2 size={14} /></button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 4 }}>
                <input className="input" style={{ width: 150 }} placeholder="شعبة جديدة..." value={newClass} onChange={(e) => setNewClass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addClass(); }} />
                <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={addClass} disabled={!newClass.trim()}><Plus size={14} /></button>
              </div>
            </div>
          </div>

          {bySource.map(([sourceId, list]) => {
            const unconfirmed = list.filter((s) => !s.confirmed && s.outcome !== "pending").length;
            return (
              <div key={sourceId} className="card" style={{ padding: "1rem 1.2rem", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <b style={{ color: "var(--indigo)" }}>{classNames.get(sourceId) ?? "—"}</b><span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>{list.length} طالباً</span>
                  {unconfirmed > 0 && (
                    <button className="btn btn-secondary" style={{ marginInlineStart: "auto", fontSize: "0.78rem", padding: "4px 12px", display: "flex", alignItems: "center", gap: 4 }} onClick={() => confirmGroup(sourceId)}>
                      <CheckCheck size={14} /> اعتمد المقترحات لهذه الشعبة ({unconfirmed})
                    </button>
                  )}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ fontSize: "0.84rem" }}>
                    <thead><tr><th>الطالب</th><th>الاقتراح</th><th>القرار</th><th>الشعبة الجديدة</th><th>تأكيد الانتساب</th></tr></thead>
                    <tbody>
                      {list.sort((a, b) => (names.get(a.student_id) ?? "").localeCompare(names.get(b.student_id) ?? "", "ar")).map((s) => (
                        <tr key={s.id}>
                          <td>{names.get(s.student_id) ?? "—"}</td>
                          <td style={{ color: OUTCOME_COLOR[s.suggested_outcome], fontWeight: 700 }}>{OUTCOME_LABEL[s.suggested_outcome]}</td>
                          <td>
                            <select className="input" style={{ minWidth: 130 }} value={s.outcome} onChange={(e) => changeOutcome(s, e.target.value as Outcome)}>
                              {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="input" style={{ minWidth: 150 }} disabled={s.outcome === "graduate" || s.outcome === "left" || s.outcome === "pending"} value={s.target_class_id ?? ""} onChange={(e) => patchStudent(s.id, { target_class_id: e.target.value || null })}>
                              <option value="">—</option>
                              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </td>
                          <td><input type="checkbox" checked={s.confirmed} disabled={s.outcome === "pending" || ((s.outcome === "promote" || s.outcome === "repeat") && !s.target_class_id)} onChange={(e) => patchStudent(s.id, { confirmed: e.target.checked })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {students.length === 0 && <p style={{ color: "var(--steel)" }}>لا طلاب مسجَّلون في الشعب الحالية، فلن يُنقل أحد.</p>}

          {canConfig ? (
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-gold" disabled={busy || !ready} onClick={apply}>{busy ? "جارٍ الاعتماد..." : "اعتماد الترحيل"}</button>
              {!ready && <span style={{ fontSize: "0.82rem", color: "var(--steel)" }}>{counts.pending > 0 ? `${counts.pending} طالباً بلا قرار` : counts.unconfirmed > 0 ? `${counts.unconfirmed} طالباً لم يُؤكَّد انتسابهم` : "أضف شعبة واحدة على الأقل"}</span>}
            </div>
          ) : <p style={{ marginTop: 16, fontSize: "0.85rem", color: "var(--steel)" }}>بعد أن تؤكد انتساب الطلاب، يعتمد الناظر العام الترحيل النهائي.</p>}
        </>
      )}

      {applied.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <b style={{ color: "var(--indigo)" }}>عمليات الترحيل السابقة</b>
          <table className="data-table" style={{ fontSize: "0.82rem", marginTop: 8 }}>
            <thead><tr><th>السنة الجديدة</th><th>التاريخ</th><th>ترفيع</th><th>إعادة</th><th>تخرّج</th><th>غادر</th></tr></thead>
            <tbody>
              {applied.map((p) => (
                <tr key={p.id}><td>{p.to_year_name}</td><td>{p.applied_at ? new Date(p.applied_at).toLocaleDateString("ar") : ""}</td>
                  <td>{p.summary?.promote ?? 0}</td><td>{p.summary?.repeat ?? 0}</td><td>{p.summary?.graduate ?? 0}</td><td>{p.summary?.left ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
