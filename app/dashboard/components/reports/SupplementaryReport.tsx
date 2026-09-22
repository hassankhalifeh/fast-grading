"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { downloadCsv } from "@/lib/reportsCsv";
import SimpleTable from "../SimpleTable";

interface Named { id: string; name: string }
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));

// نتائج الامتحان التكميلي والترفيع لدور كامل، عبر كل الصفوف والمواد دفعة واحدة (وليس صفاً بصف كما في شاشة الامتحان التكميلي).
export default function SupplementaryReport({ accountId }: { accountId: string }) {
  const [sessions, setSessions] = useState<Named[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [promo, setPromo] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("supplementary_sessions").select("id, name").eq("account_id", accountId).order("created_at", { ascending: false })
      .then(({ data }) => { setSessions((data ?? []) as Named[]); setSessionId((data ?? [])[0]?.id ?? ""); });
  }, [accountId]);

  useEffect(() => {
    if (!sessionId) { setRows([]); setPromo([]); return; }
    setLoading(true);
    (async () => {
      const [res, pr, students, classes, subjects] = await Promise.all([
        supabase.from("v_student_supplementary_result").select("*").eq("session_id", sessionId),
        supabase.from("v_student_promotion").select("*").eq("session_id", sessionId),
        supabase.from("students").select("id, full_name").eq("account_id", accountId),
        supabase.from("class_sections").select("id, name").eq("account_id", accountId),
        supabase.from("subjects").select("id, name").eq("account_id", accountId),
      ]);
      const sName = new Map((students.data ?? []).map((s: any) => [s.id, s.full_name]));
      const cName = new Map((classes.data ?? []).map((c: any) => [c.id, c.name]));
      const jName = new Map((subjects.data ?? []).map((j: any) => [j.id, j.name]));
      setRows((res.data ?? []).map((r: any) => ({ ...r, student: sName.get(r.student_id) ?? "—", cls: cName.get(r.class_section_id) ?? "—", subject: jName.get(r.subject_id) ?? "—" }))
        .sort((a: any, b: any) => a.student.localeCompare(b.student, "ar")));
      setPromo((pr.data ?? []).map((p: any) => ({ ...p, student: sName.get(p.student_id) ?? "—", cls: cName.get(p.class_section_id) ?? "—" }))
        .sort((a: any, b: any) => a.student.localeCompare(b.student, "ar")));
      setLoading(false);
    })();
  }, [sessionId, accountId]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>نتائج مادة التكميلي لكل طالب، ونتيجة الترفيع النهائية، عبر كل صفوف الدور دفعة واحدة.</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>الدور التكميلي</label>
          <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {rows.length > 0 && <button className="btn btn-secondary" onClick={() => downloadCsv("supplementary-subjects.csv", [["الطالب", "الصف", "المادة", "علامة السنة", "علامة التكميلي", "النتيجة النهائية", "كان ناجحاً قبله"], ...rows.map((r) => [r.student, r.cls, r.subject, fmt(r.year_score), fmt(r.supp_score), fmt(r.final_score), r.passed_before ? "نعم" : "لا"])])}>تصدير علامات المواد CSV</button>}
        {promo.length > 0 && <button className="btn btn-secondary" onClick={() => downloadCsv("promotion.csv", [["الطالب", "الصف", "راسب قبل", "راسب بعد", "المسموح", "النتيجة"], ...promo.map((p) => [p.student, p.cls, p.failed_before, p.failed_after, p.max_failed_subjects, p.promoted ? "مُرفَّع" : "غير مُرفَّع"])])}>تصدير الترفيع CSV</button>}
      </div>
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <>
          <h4 style={{ marginBottom: 6 }}>علامات مواد التكميلي</h4>
          <SimpleTable columns={[{ key: "student", label: "الطالب" }, { key: "cls", label: "الصف" }, { key: "subject", label: "المادة" }, { key: "year", label: "علامة السنة" }, { key: "supp", label: "علامة التكميلي" }, { key: "final", label: "النهائية" }]}
            rows={rows.map((r) => ({ student: r.student, cls: r.cls, subject: r.subject, year: fmt(r.year_score), supp: fmt(r.supp_score), final: fmt(r.final_score) }))} />
          <h4 style={{ margin: "16px 0 6px" }}>الترفيع</h4>
          <SimpleTable columns={[{ key: "student", label: "الطالب" }, { key: "cls", label: "الصف" }, { key: "before", label: "راسب قبل" }, { key: "after", label: "راسب بعد" }, { key: "result", label: "النتيجة" }]}
            rows={promo.map((p) => ({ student: p.student, cls: p.cls, before: p.failed_before, after: p.failed_after, result: p.promoted ? "مُرفَّع" : "غير مُرفَّع" }))} />
        </>
      )}
    </div>
  );
}
