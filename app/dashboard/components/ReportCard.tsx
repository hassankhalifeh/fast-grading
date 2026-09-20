"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Named { id: string; name: string }
interface Line { subject: string; terms: (number | null)[]; year: number | null; supp: number | null; final: number | null; supplementary: boolean }

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));

// الشهادة النهائية للطالب: علامة كل فصل، معدل السنة، علامة التكميلي (إن وُجد)، النتيجة النهائية للمادة، والترفيع.
export default function ReportCard({ accountId }: { accountId: string }) {
  const [classes, setClasses] = useState<Named[]>([]);
  const [sessions, setSessions] = useState<Named[]>([]);
  const [terms, setTerms] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [students, setStudents] = useState<Named[]>([]);
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [pass, setPass] = useState(50);
  const [school, setSchool] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [promotion, setPromotion] = useState<{ failedBefore: number; failedAfter: number; max: number; promoted: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("supplementary_sessions").select("id, name").eq("account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("terms").select("id, name, order_index").eq("account_id", accountId).order("order_index"),
      supabase.from("subjects").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("grading_policies").select("passing_threshold_percent").eq("account_id", accountId).maybeSingle(),
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
    ]).then(([c, s, t, su, gp, ac]) => {
      const cl = (c.data ?? []) as Named[];
      setClasses(cl);
      setSessions((s.data ?? []) as Named[]);
      setTerms((t.data ?? []) as Named[]);
      setSubjects((su.data ?? []) as Named[]);
      if (gp.data?.passing_threshold_percent != null) setPass(Number(gp.data.passing_threshold_percent));
      setSchool(ac.data?.display_name ?? "");
      setClassId((cur) => cur || cl[0]?.id || "");
    });
  }, [accountId]);

  useEffect(() => {
    if (!classId) return;
    supabase.from("class_enrollments").select("student_id, students(full_name)").eq("class_section_id", classId).eq("status", "active").then(({ data }) => {
      const list = (data ?? []).map((r: any) => ({ id: r.student_id as string, name: (r.students?.full_name ?? "—") as string })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
      setStudents(list);
      setStudentId(list[0]?.id ?? "");
    });
  }, [classId]);

  useEffect(() => {
    if (!classId || !studentId) { setLines([]); setPromotion(null); return; }
    (async () => {
      setLoading(true);
      const [tm, yr, su, pr] = await Promise.all([
        supabase.from("v_student_subject_term").select("subject_id, term_id, subject_term_score").eq("class_section_id", classId).eq("student_id", studentId),
        supabase.from("v_student_subject_year").select("subject_id, subject_year_score").eq("class_section_id", classId).eq("student_id", studentId),
        sessionId ? supabase.from("v_student_supplementary_result").select("subject_id, supp_score, final_score").eq("session_id", sessionId).eq("student_id", studentId).eq("class_section_id", classId) : Promise.resolve({ data: [] as any[] }),
        sessionId ? supabase.from("v_student_promotion").select("failed_before, failed_after, max_failed_subjects, promoted").eq("session_id", sessionId).eq("student_id", studentId).eq("class_section_id", classId).maybeSingle() : Promise.resolve({ data: null as any }),
      ]);
      const ids = new Set<string>([...(tm.data ?? []), ...(yr.data ?? [])].map((r: any) => r.subject_id));
      const out: Line[] = subjects.filter((s) => ids.has(s.id)).map((s) => {
        const y = (yr.data ?? []).find((r: any) => r.subject_id === s.id);
        const sp = ((su.data ?? []) as any[]).find((r) => r.subject_id === s.id);
        const year = y?.subject_year_score != null ? Number(y.subject_year_score) : null;
        return {
          subject: s.name,
          terms: terms.map((t) => { const r = (tm.data ?? []).find((x: any) => x.subject_id === s.id && x.term_id === t.id); return r?.subject_term_score != null ? Number(r.subject_term_score) : null; }),
          year, supp: sp?.supp_score != null ? Number(sp.supp_score) : null,
          final: sp ? (sp.final_score != null ? Number(sp.final_score) : year) : year, supplementary: !!sp,
        };
      });
      setLines(out);
      const p: any = pr.data;
      setPromotion(p ? { failedBefore: Number(p.failed_before), failedAfter: Number(p.failed_after), max: p.max_failed_subjects, promoted: p.promoted } : null);
      setLoading(false);
    })();
  }, [classId, studentId, sessionId, subjects.length, terms.length]);

  const finals = lines.filter((l) => l.final !== null).map((l) => l.final as number);
  const avg = finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : null;
  const student = students.find((s) => s.id === studentId);
  const cls = classes.find((c) => c.id === classId);

  function print() {
    if (!printRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>الشهادة</title><style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #999;padding:6px 10px;text-align:center}
      th{background:#eee} h2,h3{text-align:center;margin:4px 0}</style></head><body>${printRef.current.innerHTML}</body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>الشعبة</label>
          <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label style={lbl}>الطالب</label>
          <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label style={lbl}>دور تكميلي</label>
          <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">بدون</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        {lines.length > 0 && <button className="btn btn-secondary" onClick={print}>طباعة</button>}
      </div>
      {loading && <p style={{ color: "var(--steel)", fontSize: "0.85rem" }}>جارٍ التحميل...</p>}
      {lines.length === 0 && !loading && <p style={{ color: "var(--steel)" }}>لا توجد معدلات لهذا الطالب بعد.</p>}
      {lines.length > 0 && (
        <div className="card" style={{ padding: "1rem 1.1rem", overflowX: "auto" }} ref={printRef}>
          {school && <h2>{school}</h2>}
          <h3>الشهادة — {student?.name} ({cls?.name})</h3>
          <table className="data-table">
            <thead><tr><th>المادة</th>{terms.map((t) => <th key={t.id}>{t.name}</th>)}<th>معدل السنة</th>{sessionId && <th>التكميلي</th>}<th>النتيجة النهائية</th><th>الحالة</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.subject}>
                  <td style={{ fontWeight: 700 }}>{l.subject}</td>
                  {l.terms.map((v, i) => <td key={i}>{fmt(v)}</td>)}
                  <td>{fmt(l.year)}</td>
                  {sessionId && <td>{l.supplementary ? fmt(l.supp) : "—"}</td>}
                  <td style={{ fontWeight: 700 }}>{fmt(l.final)}</td>
                  <td style={{ color: l.final !== null && l.final >= pass ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                    {l.final === null ? "—" : l.final >= pass ? (l.supplementary && l.year !== null && l.year < pass ? "ناجح بالتكميلي" : "ناجح") : "راسب"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 10 }}>المعدل العام: <b>{fmt(avg)}</b> — حد النجاح: {pass}%</p>
          {promotion && (
            <p style={{ fontWeight: 700, color: promotion.promoted ? "var(--green)" : "var(--red)" }}>
              {promotion.promoted ? "النتيجة: مُرفَّع" : "النتيجة: غير مُرفَّع"} — مواد راسب بها قبل التكميلي: {promotion.failedBefore}، بعده: {promotion.failedAfter} (المسموح: {promotion.max})
            </p>
          )}
        </div>
      )}
    </>
  );
}
