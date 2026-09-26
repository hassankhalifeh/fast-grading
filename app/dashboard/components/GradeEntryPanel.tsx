"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, Exam, ExamTypeComponent } from "@/lib/types";
import { Lock, Unlock } from "lucide-react";
import VoiceEntry from "./VoiceEntry";
import { useTableKit } from "@/lib/tablekit";

const ROSTER_COLUMNS = [{ key: "full_name", label: "الطالب" }];

interface RosterStudent { student_id: string; full_name: string }
interface ExistingGrade { id: string; score: number }
interface Conflict { student_id: string; name: string; component_id: string | null; compName: string; old: number; new: number; resolution: "apply_new" | "keep_old"; voice?: boolean }
type ExamRow = Exam & { lock_tier?: number };

const TIER_LABEL: Record<number, string> = { 0: "مفتوح", 1: "قفل جزئي (مساعد الناظر فأعلى)", 2: "معتمد نهائياً" };

function friendly(m: string) {
  if (m.includes("row-level security")) return "ليس لديك صلاحية على هذا الإجراء";
  if (m.includes("P0002") || m.includes("grading window")) return "نافذة العلامات مقفلة لهذا الامتحان";
  return m;
}

// إدخال العلامات: العلامات الموجودة تظهر بالخانات، وأي تغيير على علامة موجودة يمر بشاشة حل التعارض
// (اعتماد الجديد / إبقاء القديم لكل مكوّن، مع سجل بالتاريخ). القفل والاعتماد النهائي والنقل حسب الصلاحية.
export default function GradeEntryPanel({ accountId, appUser, canToggleWindow, canFinalize, canEditOthers }: {
  accountId: string; appUser: AppUser; canToggleWindow: boolean; canFinalize: boolean; canEditOthers: boolean;
}) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [examId, setExamId] = useState("");
  const [components, setComponents] = useState<ExamTypeComponent[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [existing, setExisting] = useState<Record<string, ExistingGrade>>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [voiceKeys, setVoiceKeys] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [targetExam, setTargetExam] = useState("");
  const [moveIds, setMoveIds] = useState<Set<string>>(new Set());

  const exam = exams.find((e) => e.id === examId) ?? null;
  // بحث في قائمة الطلاب يُصفّي الصفوف المعروضة فقط؛ الحفظ والإدخال الصوتي يبقيان على القائمة الكاملة
  const tk = useTableKit(roster, ROSTER_COLUMNS);
  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };
  const key = (studentId: string, compId: string | null) => `${studentId}|${compId ?? "flat"}`;

  async function loadExams() {
    const { data } = await supabase.from("exams").select("*").eq("account_id", accountId).order("exam_date", { ascending: false });
    setExams((data ?? []) as ExamRow[]);
  }
  useEffect(() => { loadExams(); }, [accountId]);

  async function loadExam(e: ExamRow) {
    if (e.exam_type_id) {
      const { data } = await supabase.from("exam_type_components").select("*").eq("exam_type_id", e.exam_type_id);
      setComponents((data ?? []) as ExamTypeComponent[]);
    } else setComponents([]);

    const { data: enr } = await supabase.from("class_enrollments").select("student_id, students(full_name)")
      .eq("class_section_id", e.class_section_id).eq("status", "active");
    let rosterRows: RosterStudent[] = (enr ?? []).map((r: any) => ({ student_id: r.student_id, full_name: r.students?.full_name }));
    // الامتحان التكميلي: القائمة هي المستحقون لهذه المادة فقط
    const sessionId = (e as any).supplementary_session_id as string | null | undefined;
    if (sessionId) {
      const { data: el } = await supabase.from("supplementary_eligibility").select("student_id").eq("session_id", sessionId).eq("subject_id", e.subject_id).eq("class_section_id", e.class_section_id);
      const ids = new Set((el ?? []).map((x: any) => x.student_id));
      rosterRows = rosterRows.filter((s) => ids.has(s.student_id));
    }
    setRoster(rosterRows);

    const { data: gr } = await supabase.from("grades").select("id, student_id, component_id, score").eq("exam_id", e.id);
    const ex: Record<string, ExistingGrade> = {};
    const sc: Record<string, string> = {};
    (gr ?? []).forEach((g: any) => { ex[key(g.student_id, g.component_id)] = { id: g.id, score: Number(g.score) }; sc[key(g.student_id, g.component_id)] = String(g.score); });
    setExisting(ex);
    setScores(sc);
    setVoiceKeys(new Set());
    setConflicts(null);
  }

  useEffect(() => {
    if (exam) loadExam(exam); else { setComponents([]); setRoster([]); setExisting({}); setScores({}); }
  }, [examId, exams.length]);

  async function toggleWindow() {
    if (!exam) return;
    const { error: err } = await supabase.from("exams")
      .update({ grading_window_open: !exam.grading_window_open, grading_window_opened_by: appUser.id, grading_window_opened_at: new Date().toISOString() }).eq("id", exam.id);
    if (err) return fail(err.message);
    loadExams();
  }

  function collect() {
    const news: { student_id: string; component_id: string | null; score: number; voice?: boolean }[] = [];
    const confs: Conflict[] = [];
    const cols: { id: string | null; name: string }[] = components.length > 0 ? components.map((c) => ({ id: c.id, name: c.component_name })) : [{ id: null, name: "العلامة" }];
    for (const s of roster) {
      for (const c of cols) {
        const raw = scores[key(s.student_id, c.id)];
        if (raw === undefined || raw === "") continue;
        const num = Number(raw);
        if (Number.isNaN(num)) continue;
        const ex = existing[key(s.student_id, c.id)];
        const voice = voiceKeys.has(key(s.student_id, c.id));
        if (!ex) news.push({ student_id: s.student_id, component_id: c.id, score: num, voice });
        else if (ex.score !== num) confs.push({ student_id: s.student_id, name: s.full_name, component_id: c.id, compName: c.name, old: ex.score, new: num, resolution: "keep_old", voice });
      }
    }
    return { news, confs };
  }

  async function submit(news: { student_id: string; component_id: string | null; score: number; voice?: boolean }[], confs: Conflict[]) {
    if (!exam) return;
    setBusy(true);
    const byStudent = new Map<string, any[]>();
    news.forEach((n) => byStudent.set(n.student_id, [...(byStudent.get(n.student_id) ?? []), { component_id: n.component_id, score: n.score, entry_method: n.voice ? "voice" : "manual" }]));
    confs.forEach((c) => byStudent.set(c.student_id, [...(byStudent.get(c.student_id) ?? []), { component_id: c.component_id, score: c.new, resolution: c.resolution, entry_method: c.voice ? "voice" : "manual" }]));
    let applied = 0, skipped = 0;
    for (const [studentId, entries] of byStudent) {
      const { error: err } = await supabase.rpc("apply_grade_entry", { p_exam_id: exam.id, p_student_id: studentId, p_actor_id: appUser.id, p_entries: entries });
      if (err) { setBusy(false); await loadExam(exam); return fail(err.message); }
      entries.forEach((en: any) => (en.resolution === "keep_old" ? skipped++ : applied++));
    }
    setBusy(false);
    setConflicts(null);
    ok(`تم: ${applied} علامة محفوظة${skipped ? `، و${skipped} أُبقي فيها القديم` : ""}`);
    loadExam(exam);
  }

  function saveAll() {
    setError(null); setMessage(null);
    if (!exam) return;
    const { news, confs } = collect();
    const over = [...news.map((n) => n.score), ...confs.map((c) => c.new)].find((v) => v < 0 || v > Number(exam.max_score));
    if (over !== undefined) return fail(`العلامة ${over} خارج المدى 0 - ${exam.max_score}`);
    if (news.length === 0 && confs.length === 0) return ok("لا تغييرات للحفظ");
    if (confs.length > 0) return setConflicts(confs);
    submit(news, []);
  }

  async function lockAction(kind: "finalize" | "lower" | "reopen") {
    if (!exam) return;
    const text = { finalize: "اعتماد علامات هذا الامتحان نهائياً؟ يُقفل الإدخال والتعديل على الجميع.", lower: "رفع القفل درجة واحدة؟", reopen: "فتح الامتحان بالكامل فوراً وتجاوز التدرّج؟" }[kind];
    if (!confirm(text)) return;
    const fn = { finalize: "finalize_exam_submission", lower: "lower_exam_lock_tier", reopen: "reopen_exam_submission" }[kind];
    const { data, error: err } = await supabase.rpc(fn, { p_exam_id: exam.id, p_actor_id: appUser.id });
    if (err) return fail(err.message);
    ok(String(data));
    loadExams();
  }

  async function doReassign() {
    if (!exam || !targetExam || moveIds.size === 0) return fail("اختر الامتحان الهدف والطلاب");
    const { data, error: err } = await supabase.rpc("reassign_grades_to_exam", {
      p_student_ids: [...moveIds], p_from_exam_id: exam.id, p_to_exam_id: targetExam, p_actor_id: appUser.id,
    });
    if (err) return fail(err.message);
    ok(String(data)); setShowReassign(false); setTargetExam(""); setMoveIds(new Set());
    loadExam(exam);
  }

  const tier = exam?.lock_tier ?? 0;
  const cols = components.length > 0 ? components : null;
  const studentsWithGrades = roster.filter((s) => Object.keys(existing).some((k) => k.startsWith(s.student_id)));
  const sameGroupExams = exam ? exams.filter((x) => x.id !== exam.id && x.class_section_id === exam.class_section_id && x.subject_id === exam.subject_id) : [];

  return (
    <div>
      <select value={examId} onChange={(e) => setExamId(e.target.value)} className="input" style={{ maxWidth: 460, marginBottom: 16 }}>
        <option value="">— اختر امتحاناً —</option>
        {exams.map((e) => <option key={e.id} value={e.id}>{e.exam_name} — {e.exam_date}{(e.lock_tier ?? 0) > 0 ? " 🔒" : ""}</option>)}
      </select>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      {exam && (
        <div className="card" style={{ padding: "0.9rem 1.1rem", marginBottom: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem" }}>الاعتماد: <b style={{ color: tier === 0 ? "var(--green)" : "var(--red)" }}>{TIER_LABEL[tier]}</b></span>
          {canFinalize && tier === 0 && <button className="btn btn-secondary" onClick={() => lockAction("finalize")}><Lock size={14} /> اعتماد نهائي</button>}
          {canFinalize && tier > 0 && <button className="btn btn-secondary" onClick={() => lockAction("lower")}><Unlock size={14} /> رفع القفل درجة</button>}
          {canFinalize && tier > 0 && <button className="btn btn-secondary" onClick={() => lockAction("reopen")}>فتح فوري (طوارئ)</button>}
          {canEditOthers && tier === 0 && sameGroupExams.length > 0 && studentsWithGrades.length > 0 && (
            <button className="btn btn-secondary" onClick={() => { setShowReassign(true); setMoveIds(new Set(studentsWithGrades.map((s) => s.student_id))); }}>نقل علامات لامتحان آخر</button>
          )}
        </div>
      )}

      {exam && !exam.grading_window_open && (
        <div className="card" style={{ padding: "1.1rem", marginBottom: 16, background: "#FBF3E3" }}>
          <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--gold-dark)", fontWeight: 700 }}>
            <Lock size={16} /> نافذة العلامات مقفلة لهذا الامتحان.
          </p>
          {canToggleWindow && (
            <button onClick={toggleWindow} className="btn btn-secondary" style={{ marginTop: 10 }}><Unlock size={14} /> فتح النافذة</button>
          )}
        </div>
      )}

      {showReassign && exam && (
        <div className="card" style={{ padding: "1.1rem", marginBottom: 14 }}>
          <strong style={{ color: "var(--indigo)" }}>نقل علامات لامتحان آخر (نفس الشعبة والمادة)</strong>
          <p style={{ fontSize: "0.8rem", color: "var(--steel)", margin: "4px 0 10px" }}>لتصحيح علامات أُدخلت تحت امتحان خاطئ. يُرفض النقل إن كان للطالب علامة بالهدف (استخدم حل التعارض).</p>
          <select className="input" style={{ maxWidth: 320, marginBottom: 10 }} value={targetExam} onChange={(e) => setTargetExam(e.target.value)}>
            <option value="">— الامتحان الصحيح —</option>
            {sameGroupExams.map((x) => <option key={x.id} value={x.id}>{x.exam_name} — {x.exam_date}</option>)}
          </select>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
            {studentsWithGrades.map((s) => (
              <label key={s.student_id} style={{ fontSize: "0.85rem", display: "flex", gap: 5 }}>
                <input type="checkbox" checked={moveIds.has(s.student_id)} onChange={() => setMoveIds((p) => { const n = new Set(p); n.has(s.student_id) ? n.delete(s.student_id) : n.add(s.student_id); return n; })} /> {s.full_name}
              </label>
            ))}
          </div>
          <button className="btn btn-gold" onClick={doReassign}>نقل</button>{" "}
          <button className="btn btn-secondary" onClick={() => setShowReassign(false)}>إلغاء</button>
        </div>
      )}

      {conflicts && exam && (
        <div className="card" style={{ padding: "1.1rem", marginBottom: 14, background: "#FBF3E3" }}>
          <strong style={{ color: "var(--gold-dark)" }}>{conflicts.length} علامة موجودة مسبقاً وتختلف عن المُدخَل — قرّر لكل واحدة</strong>
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead><tr><th>الطالب</th><th>المكوّن</th><th>القديمة</th><th>الجديدة</th><th>القرار</th></tr></thead>
            <tbody>
              {conflicts.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td><td>{c.compName}</td><td>{c.old}</td><td style={{ fontWeight: 700 }}>{c.new}</td>
                  <td>
                    <select className="input" style={{ maxWidth: 150 }} value={c.resolution}
                      onChange={(e) => setConflicts(conflicts.map((x, j) => (j === i ? { ...x, resolution: e.target.value as any } : x)))}>
                      <option value="keep_old">إبقاء القديمة</option>
                      <option value="apply_new">اعتماد الجديدة</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn btn-gold" disabled={busy} onClick={() => { const { news } = collect(); submit(news, conflicts); }}>تنفيذ القرارات</button>
            <button className="btn btn-secondary" onClick={() => setConflicts(conflicts.map((c) => ({ ...c, resolution: "apply_new" })))}>اعتماد كل الجديد</button>
            <button className="btn btn-secondary" onClick={() => setConflicts(conflicts.map((c) => ({ ...c, resolution: "keep_old" })))}>تجاهل كل التعديلات</button>
            <button className="btn btn-secondary" onClick={() => setConflicts(null)}>رجوع</button>
          </div>
        </div>
      )}

      {exam && exam.grading_window_open && !conflicts && (
        <>
          {canToggleWindow && (
            <button onClick={toggleWindow} className="btn btn-secondary" style={{ marginBottom: 14 }}><Lock size={14} /> قفل النافذة</button>
          )}
          <VoiceEntry
            roster={roster.map((s) => ({ id: s.student_id, name: s.full_name }))}
            components={cols ? cols.map((c) => ({ id: c.id, name: c.component_name })) : null}
            maxScore={Number(exam.max_score)}
            onApply={(rows) => {
              setScores((p) => { const n = { ...p }; rows.forEach((r) => { n[key(r.studentId, r.componentId)] = String(r.score); }); return n; });
              setVoiceKeys((p) => { const n = new Set(p); rows.forEach((r) => n.add(key(r.studentId, r.componentId))); return n; });
              ok(`طُبّقت ${rows.length} علامة على الجدول — راجعها ثم اضغط «حفظ العلامات»`);
            }}
          />
          {tk.toolbar}
          <div className="card fade-in" style={{ overflow: "hidden", marginBottom: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  {cols ? cols.map((c) => <th key={c.id}>{c.component_name} ({c.weight_percent}%)</th>) : <th>العلامة (من {exam.max_score})</th>}
                </tr>
              </thead>
              <tbody>
                {tk.rows.map((s) => (
                  <tr key={s.student_id}>
                    <td>{s.full_name}</td>
                    {(cols ?? [{ id: null as string | null }]).map((c: any) => {
                      const k = key(s.student_id, c.id);
                      const changed = existing[k] !== undefined && scores[k] !== undefined && scores[k] !== "" && Number(scores[k]) !== existing[k].score;
                      return (
                        <td key={k}>
                          <input type="number" className="input" style={{ width: 90, borderColor: changed ? "var(--gold-dark)" : undefined }}
                            value={scores[k] ?? ""}
                            onChange={(e) => { setScores((p) => ({ ...p, [k]: e.target.value })); setVoiceKeys((p) => { if (!p.has(k)) return p; const n = new Set(p); n.delete(k); return n; }); }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {roster.length === 0 && <p style={{ padding: 12, color: "var(--steel)" }}>لا يوجد طلاب مسجّلون بهذه الشعبة.</p>}
          </div>
          <button onClick={saveAll} disabled={busy} className="btn btn-gold">{busy ? "جارٍ الحفظ..." : "حفظ العلامات"}</button>
        </>
      )}
    </div>
  );
}
