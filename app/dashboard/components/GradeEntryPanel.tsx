"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, Exam, ExamTypeComponent } from "@/lib/types";
import { Lock, Unlock } from "lucide-react";

interface RosterStudent { student_id: string; full_name: string; }

// Manual entry for now — the voice-to-data flow documented in the
// project README is a separate, larger build (speech capture +
// fuzzy name matching + a live draft table) and isn't included here.
// This screen still implements the two things that actually protect
// data integrity: the grading-window gate and multi-component entry.
export default function GradeEntryPanel({ accountId, appUser, canToggleWindow }: {
  accountId: string; appUser: AppUser; canToggleWindow: boolean;
}) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [exam, setExam] = useState<Exam | null>(null);
  const [components, setComponents] = useState<ExamTypeComponent[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({}); // studentId -> componentId('flat') -> score
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from("exams").select("*").eq("account_id", accountId).order("exam_date", { ascending: false })
      .then(({ data }) => setExams(data ?? []));
  }, [accountId]);

  useEffect(() => {
    if (!examId) { setExam(null); return; }
    const e = exams.find((x) => x.id === examId) ?? null;
    setExam(e);
    if (!e) return;

    if (e.exam_type_id) {
      supabase.from("exam_type_components").select("*").eq("exam_type_id", e.exam_type_id)
        .then(({ data }) => setComponents(data ?? []));
    } else {
      setComponents([]);
    }

    supabase
      .from("class_enrollments")
      .select("student_id, students(full_name)")
      .eq("class_section_id", e.class_section_id)
      .eq("status", "active")
      .then(({ data }) => {
        setRoster((data ?? []).map((r: any) => ({ student_id: r.student_id, full_name: r.students?.full_name })));
      });
  }, [examId, exams]);

  function setScore(studentId: string, componentKey: string, value: number) {
    setScores((s) => ({ ...s, [studentId]: { ...s[studentId], [componentKey]: value } }));
  }

  async function toggleWindow() {
    if (!exam) return;
    const { error } = await supabase.from("exams")
      .update({ grading_window_open: !exam.grading_window_open, grading_window_opened_by: appUser.id, grading_window_opened_at: new Date().toISOString() })
      .eq("id", exam.id);
    if (!error) setExam({ ...exam, grading_window_open: !exam.grading_window_open });
  }

  async function saveAll() {
    if (!exam) return;
    const rows: any[] = [];

    for (const student of roster) {
      const studentScores = scores[student.student_id] ?? {};
      if (components.length > 0) {
        for (const c of components) {
          const val = studentScores[c.id];
          if (val === undefined || Number.isNaN(val)) continue;
          rows.push({ exam_id: exam.id, student_id: student.student_id, component_id: c.id, score: val, entered_by: appUser.id, status: "confirmed" });
        }
      } else {
        const val = studentScores["flat"];
        if (val === undefined || Number.isNaN(val)) continue;
        rows.push({ exam_id: exam.id, student_id: student.student_id, component_id: null, score: val, entered_by: appUser.id, status: "confirmed" });
      }
    }

    if (rows.length === 0) return;
    const { error } = await supabase.from("grades").upsert(rows, { onConflict: "exam_id,student_id,component_id" });
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  }

  return (
    <div>
      <select value={examId} onChange={(e) => setExamId(e.target.value)} className="input" style={{ maxWidth: 460, marginBottom: 16 }}>
        <option value="">— اختر امتحاناً —</option>
        {exams.map((e) => <option key={e.id} value={e.id}>{e.exam_name} — {e.exam_date}</option>)}
      </select>

      {exam && !exam.grading_window_open && (
        <div className="card" style={{ padding: "1.1rem", marginBottom: 16, background: "#FBF3E3" }}>
          <p style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--gold-dark)", fontWeight: 700 }}>
            <Lock size={16} /> نافذة العلامات مقفلة لهذا الامتحان.
          </p>
          {canToggleWindow && (
            <button onClick={toggleWindow} className="btn btn-secondary" style={{ marginTop: 10 }}>
              <Unlock size={14} /> فتح النافذة
            </button>
          )}
        </div>
      )}

      {exam && exam.grading_window_open && (
        <>
          {canToggleWindow && (
            <button onClick={toggleWindow} className="btn btn-secondary" style={{ marginBottom: 14 }}>
              <Lock size={14} /> قفل النافذة
            </button>
          )}

          <div className="card fade-in" style={{ overflow: "hidden", marginBottom: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  {components.length > 0
                    ? components.map((c) => <th key={c.id}>{c.component_name} ({c.weight_percent}%)</th>)
                    : <th>العلامة</th>}
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => (
                  <tr key={s.student_id}>
                    <td>{s.full_name}</td>
                    {components.length > 0
                      ? components.map((c) => (
                          <td key={c.id}>
                            <input type="number" className="input" style={{ width: 90 }}
                              onChange={(e) => setScore(s.student_id, c.id, e.target.valueAsNumber)} />
                          </td>
                        ))
                      : (
                          <td>
                            <input type="number" className="input" style={{ width: 90 }}
                              onChange={(e) => setScore(s.student_id, "flat", e.target.valueAsNumber)} />
                          </td>
                        )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={saveAll} className="btn btn-gold">{saved ? "تم الحفظ ✓" : "حفظ العلامات"}</button>
        </>
      )}
    </div>
  );
}
