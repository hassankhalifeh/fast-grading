"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { useTableKit } from "@/lib/tablekit";

const CAND_COLUMNS = [{ key: "student_name", label: "الطالب" }, { key: "class_name", label: "الشعبة" }, { key: "subject_name", label: "المادة" }, { key: "year_text", label: "علامة السنة" }];
const RESULT_COLUMNS = [{ key: "student", label: "الطالب" }, { key: "subject", label: "المادة" }, { key: "year_text", label: "علامة السنة" }, { key: "supp_text", label: "التكميلي" }, { key: "final_text", label: "النهائية" }, { key: "thr_text", label: "حد النجاح" }];
const PROMO_COLUMNS = [{ key: "student", label: "الطالب" }, { key: "class", label: "الشعبة" }, { key: "failed_before", label: "راسب قبل التكميلي" }, { key: "failed_after", label: "راسب بعده" }, { key: "status", label: "الحالة" }];

interface Named { id: string; name: string }
type Mode = "replace" | "higher_of" | "capped_at_pass";
interface Session { id: string; name: string; mode: Mode; max_failed_subjects: number; academic_year_id: string | null }
interface Eligible { id: string; student_id: string; subject_id: string; class_section_id: string; reason: string | null }
interface Candidate { student_id: string; student_name: string; class_section_id: string; class_name: string; subject_id: string; subject_name: string; year_score: number }

const MODE_LABEL: Record<Mode, string> = {
  capped_at_pass: "سقف عند حد النجاح (نجاح التكميلي يرفع العلامة إلى حد النجاح فقط)",
  higher_of: "الأعلى بين علامة السنة والتكميلي",
  replace: "علامة التكميلي تحل محل علامة السنة",
};
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));

function friendly(m: string) {
  if (m.includes("row-level security")) return "ليس لديك صلاحية إدارة الامتحان التكميلي";
  if (m.includes("duplicate")) return "موجود مسبقاً";
  return m;
}

// الدور التكميلي: الإدارة تحدد المواد والطلاب المستحقين (مع اقتراح الضعفاء تحت حد النجاح)، ثم امتحان لكل شعبة/مادة.
// أثره على العلامة النهائية والترفيع حسب سياسة الدور. لا يدخل بمعدلات الفصول والسنة.
export default function SupplementaryPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [classes, setClasses] = useState<Named[]>([]);
  const [students, setStudents] = useState<Named[]>([]);
  const [years, setYears] = useState<Named[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [promotion, setPromotion] = useState<any[]>([]);
  const [selCand, setSelCand] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));

  const [nName, setNName] = useState("");
  const [nMode, setNMode] = useState<Mode>("capped_at_pass");
  const [nMax, setNMax] = useState(0);
  const [nYear, setNYear] = useState("");

  const [mClass, setMClass] = useState("");
  const [mStudent, setMStudent] = useState("");
  const [mSubject, setMSubject] = useState("");
  const [classStudents, setClassStudents] = useState<Named[]>([]);

  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const nameOf = (list: Named[], id: string) => list.find((x) => x.id === id)?.name ?? "—";

  // صفوف الجداول الثلاثة بنصوصها الظاهرة (أسماء لا معرّفات) ليعمل عليها البحث والفلترة
  const candRows = useMemo(() => candidates.map((c) => ({ ...c, year_text: fmt(c.year_score) })), [candidates]);
  const resultRows = useMemo(() => results.map((r) => ({
    ...r, student: nameOf(students, r.student_id), subject: nameOf(subjects, r.subject_id), year_text: fmt(r.year_score),
    supp_text: r.supp_score === null ? "لم يُجرَ" : fmt(r.supp_score), final_text: fmt(r.final_score), thr_text: fmt(r.pass_threshold),
  })), [results, students, subjects]);
  const promoRows = useMemo(() => promotion.filter((p) => Number(p.failed_before) > 0).map((p) => ({
    ...p, student: nameOf(students, p.student_id), class: nameOf(classes, p.class_section_id), status: p.promoted ? "مرفَّع" : "غير مرفَّع",
  })), [promotion, students, classes]);
  const candTk = useTableKit(candRows, CAND_COLUMNS);
  const resultTk = useTableKit(resultRows, RESULT_COLUMNS);
  const promoTk = useTableKit(promoRows, PROMO_COLUMNS);

  async function loadBase() {
    const [se, su, cl, st, yr] = await Promise.all([
      supabase.from("supplementary_sessions").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("subjects").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("students").select("id, full_name").eq("account_id", accountId),
      supabase.from("academic_years").select("id, name").eq("account_id", accountId),
    ]);
    const list = (se.data ?? []) as Session[];
    setSessions(list);
    setSubjects((su.data ?? []) as Named[]);
    setClasses((cl.data ?? []) as Named[]);
    setStudents((st.data ?? []).map((x: any) => ({ id: x.id, name: x.full_name })));
    setYears((yr.data ?? []) as Named[]);
    setSessionId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? ""));
  }
  useEffect(() => { loadBase(); }, [accountId]);

  async function loadSession(id: string) {
    const [ss, el, cand, res, pro] = await Promise.all([
      supabase.from("supplementary_subjects").select("subject_id").eq("session_id", id),
      supabase.from("supplementary_eligibility").select("*").eq("session_id", id),
      supabase.rpc("supplementary_candidates", { p_session: id }),
      supabase.from("v_student_supplementary_result").select("*").eq("session_id", id),
      supabase.from("v_student_promotion").select("*").eq("session_id", id),
    ]);
    setChosen(new Set((ss.data ?? []).map((x: any) => x.subject_id)));
    setEligible((el.data ?? []) as Eligible[]);
    setCandidates((cand.data ?? []) as Candidate[]);
    setResults(res.data ?? []);
    setPromotion(pro.data ?? []);
    setSelCand(new Set());
  }
  useEffect(() => { if (sessionId) loadSession(sessionId); }, [sessionId]);

  useEffect(() => {
    if (!mClass) { setClassStudents([]); return; }
    supabase.from("class_enrollments").select("student_id, students(full_name)").eq("class_section_id", mClass).eq("status", "active")
      .then(({ data }) => setClassStudents((data ?? []).map((r: any) => ({ id: r.student_id, name: r.students?.full_name }))));
  }, [mClass]);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    if (!nName) return fail("اكتب اسم الدور");
    const { data, error: err } = await supabase.from("supplementary_sessions").insert({
      account_id: accountId, name: nName, mode: nMode, max_failed_subjects: nMax, academic_year_id: nYear || null, created_by: appUser.id,
    }).select().single();
    if (err) return fail(err.message);
    setNName(""); ok("تم إنشاء الدور"); await loadBase(); if (data) setSessionId(data.id);
  }

  async function updateSession(patch: Partial<Session>) {
    if (!session) return;
    const { error: err } = await supabase.from("supplementary_sessions").update(patch).eq("id", session.id);
    if (err) return fail(err.message);
    ok("تم الحفظ"); loadBase(); loadSession(session.id);
  }

  async function deleteSession() {
    if (!session || !confirm(`حذف الدور "${session.name}" بكل استحقاقاته؟ (الامتحانات التكميلية تبقى كامتحانات عادية)`)) return;
    const { error: err } = await supabase.from("supplementary_sessions").delete().eq("id", session.id);
    if (err) return fail(err.message);
    setSessionId(""); ok("تم الحذف"); loadBase();
  }

  async function toggleSubject(subjectId: string, on: boolean) {
    if (!session) return;
    const q = on
      ? supabase.from("supplementary_subjects").insert({ session_id: session.id, subject_id: subjectId })
      : supabase.from("supplementary_subjects").delete().eq("session_id", session.id).eq("subject_id", subjectId);
    const { error: err } = await q;
    if (err) return fail(err.message.includes("foreign key") ? "لا يمكن إزالة مادة لها طلاب مستحقون" : err.message);
    loadSession(session.id);
  }

  async function addCandidates() {
    if (!session || selCand.size === 0) return;
    const rows = candidates.filter((c) => selCand.has(`${c.student_id}|${c.subject_id}`)).map((c) => ({
      session_id: session.id, student_id: c.student_id, subject_id: c.subject_id, class_section_id: c.class_section_id,
      reason: `علامة السنة ${fmt(c.year_score)} أقل من حد النجاح`, added_by: appUser.id,
    }));
    const { error: err } = await supabase.from("supplementary_eligibility").insert(rows);
    if (err) return fail(err.message);
    ok(`أُضيف ${rows.length} استحقاق`); loadSession(session.id);
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !mClass || !mStudent || !mSubject) return fail("اختر الشعبة والطالب والمادة");
    const { error: err } = await supabase.from("supplementary_eligibility").insert({
      session_id: session.id, student_id: mStudent, subject_id: mSubject, class_section_id: mClass, reason: "إضافة يدوية من الإدارة", added_by: appUser.id,
    });
    if (err) return fail(err.message);
    setMStudent(""); ok("تمت الإضافة"); loadSession(session.id);
  }

  async function removeEligible(id: string) {
    const { error: err } = await supabase.from("supplementary_eligibility").delete().eq("id", id);
    if (err) return fail(err.message);
    if (session) loadSession(session.id);
  }

  async function createExam(classId: string, subjectId: string) {
    if (!session) return;
    const { error: err } = await supabase.rpc("create_supplementary_exam", { p_session: session.id, p_class: classId, p_subject: subjectId, p_date: examDate, p_max: 100 });
    if (err) return fail(err.message);
    ok("أُنشئ الامتحان التكميلي — تجده في \"إدخال العلامات\"");
  }

  const groups = Array.from(new Map(eligible.map((e) => [`${e.class_section_id}|${e.subject_id}`, { class: e.class_section_id, subject: e.subject_id }])).values());

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        امتحان تكميلي لطلاب تحددهم الإدارة لدعم الضعفاء بالترفيع، ولمواد تحددها الإدارة. لا يُعدّل معدلات الفصول والسنة، وإنما يحدد العلامة النهائية للمادة والترفيع حسب سياسة الدور.
      </p>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      <form onSubmit={createSession} className="card" style={{ padding: "1.1rem", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>دور تكميلي جديد</label><input className="input" value={nName} placeholder="مثلاً: تكميلي 2026-2027" onChange={(e) => setNName(e.target.value)} /></div>
        <div><label style={lbl}>أثر النتيجة</label>
          <select className="input" style={{ maxWidth: 280 }} value={nMode} onChange={(e) => setNMode(e.target.value as Mode)}>
            {Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div><label style={lbl}>أقصى مواد راسبة للترفيع</label><input type="number" min={0} className="input" style={{ width: 90 }} value={nMax} onChange={(e) => setNMax(e.target.valueAsNumber || 0)} /></div>
        {years.length > 0 && <div><label style={lbl}>السنة</label>
          <select className="input" value={nYear} onChange={(e) => setNYear(e.target.value)}><option value="">—</option>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></div>}
        <button className="btn btn-gold" type="submit">إنشاء</button>
      </form>

      {sessions.length === 0 && <p style={{ color: "var(--steel)" }}>لا توجد أدوار تكميلية بعد.</p>}
      {sessions.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <select className="input" style={{ maxWidth: 300 }} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {session && (
            <>
              <select className="input" style={{ maxWidth: 300 }} value={session.mode} onChange={(e) => updateSession({ mode: e.target.value as Mode })}>
                {Object.entries(MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <label style={{ fontSize: "0.8rem" }}>أقصى راسبة:{" "}
                <input type="number" min={0} className="input" style={{ width: 70, display: "inline-block" }} defaultValue={session.max_failed_subjects}
                  key={session.id + session.max_failed_subjects} onBlur={(e) => Number(e.target.value) !== session.max_failed_subjects && updateSession({ max_failed_subjects: Number(e.target.value) })} /></label>
              <button onClick={deleteSession} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={16} /></button>
            </>
          )}
        </div>
      )}

      {session && (
        <>
          <div className="card" style={{ padding: "1rem", marginBottom: 14 }}>
            <strong style={{ color: "var(--indigo)" }}>١) مواد الدور التكميلي</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
              {subjects.map((s) => (
                <label key={s.id} style={{ display: "flex", gap: 6, fontSize: "0.9rem" }}>
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={(e) => toggleSubject(s.id, e.target.checked)} /> {s.name}
                </label>
              ))}
              {subjects.length === 0 && <span style={{ color: "var(--steel)" }}>أضف مواد من قسم "المواد" أولاً.</span>}
            </div>
          </div>

          <div className="card" style={{ padding: "1rem", marginBottom: 14 }}>
            <strong style={{ color: "var(--indigo)" }}>٢) الطلاب المرشّحون (علامة سنتهم أقل من حد النجاح)</strong>
            {candidates.length === 0 ? <p style={{ color: "var(--steel)", fontSize: "0.85rem", margin: "8px 0 0" }}>لا يوجد مرشحون (تظهر الاقتراحات بعد وجود علامات سنة لمواد الدور).</p> : (
              <>
                {candTk.toolbar}
                <table className="data-table" style={{ marginTop: 8 }}>
                  <thead><tr><th></th><th>الطالب</th><th>الشعبة</th><th>المادة</th><th>علامة السنة</th></tr></thead>
                  <tbody>
                    {candTk.rows.map((c) => {
                      const k = `${c.student_id}|${c.subject_id}`;
                      return (
                        <tr key={k}>
                          <td><input type="checkbox" checked={selCand.has(k)} onChange={() => setSelCand((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; })} /></td>
                          <td>{c.student_name}</td><td>{c.class_name}</td><td>{c.subject_name}</td><td>{c.year_text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button className="btn btn-gold" style={{ marginTop: 8 }} disabled={selCand.size === 0} onClick={addCandidates}>إضافة المحدّدين كمستحقين ({selCand.size})</button>
                <button className="btn btn-secondary" style={{ marginTop: 8, marginInlineStart: 8 }} onClick={() => setSelCand(new Set(candidates.map((c) => `${c.student_id}|${c.subject_id}`)))}>تحديد الكل</button>
              </>
            )}
            <form onSubmit={addManual} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--fog)" }}>
              <div><label style={lbl}>إضافة يدوية — الشعبة</label>
                <select className="input" value={mClass} onChange={(e) => { setMClass(e.target.value); setMStudent(""); }}><option value="">— اختر —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>الطالب</label>
                <select className="input" value={mStudent} onChange={(e) => setMStudent(e.target.value)}><option value="">— اختر —</option>{classStudents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label style={lbl}>المادة</label>
                <select className="input" value={mSubject} onChange={(e) => setMSubject(e.target.value)}><option value="">— اختر —</option>{subjects.filter((s) => chosen.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <button className="btn btn-secondary" type="submit">إضافة</button>
            </form>
          </div>

          <div className="card" style={{ padding: "1rem", marginBottom: 14 }}>
            <strong style={{ color: "var(--indigo)" }}>٣) المستحقون والامتحانات</strong>
            <div style={{ margin: "8px 0", display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: "0.8rem" }}>تاريخ الامتحان:</label>
              <input type="date" className="input" style={{ maxWidth: 170 }} value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </div>
            {groups.length === 0 && <p style={{ color: "var(--steel)", fontSize: "0.85rem" }}>لا يوجد مستحقون بعد.</p>}
            {groups.map((g) => (
              <div key={`${g.class}|${g.subject}`} style={{ borderTop: "1px solid var(--fog)", paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{nameOf(subjects, g.subject)} — {nameOf(classes, g.class)}</strong>
                  <button className="btn btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => createExam(g.class, g.subject)}>إنشاء الامتحان التكميلي</button>
                </div>
                {eligible.filter((e) => e.class_section_id === g.class && e.subject_id === g.subject).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "3px 0" }}>
                    <span>{nameOf(students, e.student_id)} <span style={{ color: "var(--steel)" }}>({e.reason})</span></span>
                    <button onClick={() => removeEligible(e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {results.length > 0 && (
            <div className="card" style={{ padding: "1rem", marginBottom: 14, overflowX: "auto" }}>
              <strong style={{ color: "var(--indigo)" }}>٤) نتائج التكميلي</strong>
              {resultTk.toolbar}
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead><tr><th>الطالب</th><th>المادة</th><th>علامة السنة</th><th>التكميلي</th><th>النهائية</th><th>حد النجاح</th></tr></thead>
                <tbody>
                  {resultTk.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.student}</td><td>{r.subject}</td>
                      <td>{r.year_text}</td><td>{r.supp_text}</td>
                      <td style={{ fontWeight: 700, color: Number(r.final_score) >= Number(r.pass_threshold) ? "var(--green)" : "var(--red)" }}>{r.final_text}</td>
                      <td>{r.thr_text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {promotion.length > 0 && (
            <div className="card" style={{ padding: "1rem", overflowX: "auto" }}>
              <strong style={{ color: "var(--indigo)" }}>٥) الترفيع (الحد المسموح: {session.max_failed_subjects} مادة راسبة)</strong>
              {promoTk.toolbar}
              <table className="data-table" style={{ marginTop: 8 }}>
                <thead><tr><th>الطالب</th><th>الشعبة</th><th>راسب قبل التكميلي</th><th>راسب بعده</th><th>الحالة</th></tr></thead>
                <tbody>
                  {promoTk.rows.map((p, i) => (
                    <tr key={i}>
                      <td>{p.student}</td><td>{p.class}</td><td>{p.failed_before}</td><td>{p.failed_after}</td>
                      <td style={{ fontWeight: 700, color: p.promoted ? "var(--green)" : "var(--red)" }}>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: "0.78rem", color: "var(--steel)", marginTop: 6 }}>تظهر هنا الطلاب الذين رسبوا بمادة أو أكثر بعلامة السنة.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
