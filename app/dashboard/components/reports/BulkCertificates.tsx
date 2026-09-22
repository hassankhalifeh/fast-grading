"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Named { id: string; name: string }
interface Line { subject: string; terms: (number | null)[]; year: number | null; supp: number | null; final: number | null; supplementary: boolean }
interface Promotion { failedBefore: number; failedAfter: number; max: number; promoted: boolean }
interface StudentCert { name: string; lines: Line[]; promotion: Promotion | null }

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));

// طباعة شهادات كل طلاب صف دفعة واحدة (نفس حساب الشهادة الفردية)، كل شهادة في صفحة طباعة منفصلة.
export default function BulkCertificates({ accountId }: { accountId: string }) {
  const [classes, setClasses] = useState<Named[]>([]);
  const [sessions, setSessions] = useState<Named[]>([]);
  const [terms, setTerms] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [classId, setClassId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [pass, setPass] = useState(50);
  const [school, setSchool] = useState("");
  const [certs, setCerts] = useState<StudentCert[] | null>(null);
  const [loading, setLoading] = useState(false);

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
      setClasses(cl); setSessions((s.data ?? []) as Named[]); setTerms((t.data ?? []) as Named[]); setSubjects((su.data ?? []) as Named[]);
      if (gp.data?.passing_threshold_percent != null) setPass(Number(gp.data.passing_threshold_percent));
      setSchool(ac.data?.display_name ?? "");
      setClassId((cur) => cur || cl[0]?.id || "");
    });
  }, [accountId]);

  async function build() {
    if (!classId) return;
    setLoading(true); setCerts(null);
    const [enr, tm, yr, su, pr] = await Promise.all([
      supabase.from("class_enrollments").select("student_id, students(full_name)").eq("class_section_id", classId).eq("status", "active"),
      supabase.from("v_student_subject_term").select("student_id, subject_id, term_id, subject_term_score").eq("class_section_id", classId),
      supabase.from("v_student_subject_year").select("student_id, subject_id, subject_year_score").eq("class_section_id", classId),
      sessionId ? supabase.from("v_student_supplementary_result").select("student_id, subject_id, supp_score, final_score").eq("session_id", sessionId).eq("class_section_id", classId) : Promise.resolve({ data: [] as any[] }),
      sessionId ? supabase.from("v_student_promotion").select("student_id, failed_before, failed_after, max_failed_subjects, promoted").eq("session_id", sessionId).eq("class_section_id", classId) : Promise.resolve({ data: [] as any[] }),
    ]);
    const students = ((enr.data ?? []) as any[]).map((r) => ({ id: r.student_id as string, name: (r.students?.full_name ?? "—") as string })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    const list: StudentCert[] = students.map((st) => {
      const subjIds = new Set<string>([...(tm.data ?? []), ...(yr.data ?? [])].filter((r: any) => r.student_id === st.id).map((r: any) => r.subject_id));
      const lines = subjects.filter((s) => subjIds.has(s.id)).map((s) => {
        const y = (yr.data ?? []).find((r: any) => r.student_id === st.id && r.subject_id === s.id);
        const sp = ((su.data ?? []) as any[]).find((r) => r.student_id === st.id && r.subject_id === s.id);
        const year = y?.subject_year_score != null ? Number(y.subject_year_score) : null;
        return {
          subject: s.name,
          terms: terms.map((t) => { const r = (tm.data ?? []).find((x: any) => x.student_id === st.id && x.subject_id === s.id && x.term_id === t.id); return r?.subject_term_score != null ? Number(r.subject_term_score) : null; }),
          year, supp: sp?.supp_score != null ? Number(sp.supp_score) : null,
          final: sp ? (sp.final_score != null ? Number(sp.final_score) : year) : year, supplementary: !!sp,
        };
      });
      const p = ((pr.data ?? []) as any[]).find((r) => r.student_id === st.id);
      const promotion: Promotion | null = p ? { failedBefore: Number(p.failed_before), failedAfter: Number(p.failed_after), max: p.max_failed_subjects, promoted: p.promoted } : null;
      return { name: st.name, lines, promotion };
    }).filter((c) => c.lines.length > 0);
    setCerts(list);
    setLoading(false);
  }

  function print() {
    if (!certs) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const clsName = classes.find((c) => c.id === classId)?.name ?? "";
    const pages = certs.map((c) => {
      const finals = c.lines.filter((l) => l.final !== null).map((l) => l.final as number);
      const avg = finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : null;
      const rows = c.lines.map((l) => `<tr><td style="font-weight:700">${l.subject}</td>${l.terms.map((v) => `<td>${fmt(v)}</td>`).join("")}<td>${fmt(l.year)}</td>${sessionId ? `<td>${l.supplementary ? fmt(l.supp) : "—"}</td>` : ""}<td style="font-weight:700">${fmt(l.final)}</td><td style="color:${l.final !== null && l.final >= pass ? "green" : "red"};font-weight:700">${l.final === null ? "—" : l.final >= pass ? (l.supplementary && l.year !== null && l.year < pass ? "ناجح بالتكميلي" : "ناجح") : "راسب"}</td></tr>`).join("");
      const promo = c.promotion
        ? `<p style="font-weight:700;color:${c.promotion.promoted ? "green" : "red"}">${c.promotion.promoted ? "النتيجة: مُرفَّع" : "النتيجة: غير مُرفَّع"} — مواد راسب بها قبل التكميلي: ${c.promotion.failedBefore}، بعده: ${c.promotion.failedAfter} (المسموح: ${c.promotion.max})</p>` : "";
      return `<div class="page"><h2>${school}</h2><h3>الشهادة — ${c.name} (${clsName})</h3>
        <table><thead><tr><th>المادة</th>${terms.map((t) => `<th>${t.name}</th>`).join("")}<th>معدل السنة</th>${sessionId ? "<th>التكميلي</th>" : ""}<th>النتيجة النهائية</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>
        <p style="margin-top:10px">المعدل العام: <b>${fmt(avg)}</b> — حد النجاح: ${pass}%</p>${promo}</div>`;
    }).join("");
    w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>شهادات ${clsName}</title><style>
      body{font-family:Tahoma,Arial,sans-serif} .page{padding:24px;page-break-after:always}
      table{border-collapse:collapse;width:100%} th,td{border:1px solid #999;padding:5px 8px;text-align:center;font-size:0.85rem}
      th{background:#eee} h2,h3{text-align:center;margin:4px 0}</style></head><body>${pages}</body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>يطبع شهادة كل طالب في الصف على صفحة منفصلة، دفعة واحدة، بنفس حساب الشهادة الفردية.</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>الشعبة</label>
          <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setCerts(null); }}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label style={lbl}>دور تكميلي (اختياري)</label>
          <select className="input" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setCerts(null); }}><option value="">بدون</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <button className="btn btn-gold" disabled={loading || !classId} onClick={build}>{loading ? "جارٍ التحضير..." : "تحضير الشهادات"}</button>
        {certs && certs.length > 0 && <button className="btn btn-secondary" onClick={print}>طباعة {certs.length} شهادة</button>}
      </div>
      {certs && (certs.length === 0 ? <p style={{ color: "var(--steel)" }}>لا معدلات لهذا الصف بعد.</p> : <p style={{ color: "var(--green)" }}>جاهزة {certs.length} شهادة — اضغط «طباعة».</p>)}
    </div>
  );
}
