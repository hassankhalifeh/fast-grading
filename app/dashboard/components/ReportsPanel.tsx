"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import SimpleTable from "./SimpleTable";
import { useTableKit } from "@/lib/tablekit";
import ReportCard from "./ReportCard";

interface Named { id: string; name: string }
type Tab = "final" | "card" | "class" | "summary" | "weights";

const SOURCE_LABEL: Record<string, string> = {
  default: "افتراضي", school: "المدرسة", stage: "المرحلة", class: "الصف", subject: "المادة", class_subject: "صف + مادة",
};
// جدول معدلات الصف (أعمدة ديناميكية حسب المواد): بحث وفلترة بالأعمدة نفسها
function ClassTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const cols = head.map((h, i) => ({ key: String(i), label: h }));
  const tk = useTableKit(rows, cols, { getText: (r, k) => String(r[Number(k)] ?? "") });
  return (
    <>
      {tk.toolbar}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {tk.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j === 0 ? { fontWeight: 700 } : undefined}>{c}</td>)}</tr>)}
            {tk.active && tk.rows.length === 0 && <tr><td colSpan={head.length} style={{ textAlign: "center", color: "var(--steel)" }}>لا نتائج مطابقة للبحث.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));

function downloadCsv(name: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// التقارير: بطاقة العلامات، معدلات الصف (فصل/سنة) مع الترتيب والاكتمال، ملخص الصفوف والمدرسة، والأوزان المطبَّقة ومصدرها.
// كلها تحترم نطاق صلاحيتك (المعلم يرى مادته وشعبته، وناظر المرحلة مرحلته، والناظر العام كل شيء).
export default function ReportsPanel({ accountId }: { accountId: string }) {
  const [tab, setTab] = useState<Tab>("class");
  const [classes, setClasses] = useState<Named[]>([]);
  const [subjects, setSubjects] = useState<Named[]>([]);
  const [terms, setTerms] = useState<Named[]>([]);
  const [stages, setStages] = useState<Named[]>([]);
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("year");
  const [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [cardRows, setCardRows] = useState<Record<string, any>[]>([]);
  const [classTable, setClassTable] = useState<{ head: string[]; rows: (string | number)[][]; partial: boolean } | null>(null);
  const [summary, setSummary] = useState<{ classRows: any[]; school: any | null } | null>(null);
  const [weights, setWeights] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("subjects").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("terms").select("id, name, order_index").eq("account_id", accountId).order("order_index"),
      supabase.from("stages").select("id, stage_name").eq("account_id", accountId),
    ]).then(([c, s, t, st]) => {
      const cl = (c.data ?? []) as Named[];
      setClasses(cl);
      setSubjects((s.data ?? []) as Named[]);
      setTerms((t.data ?? []) as Named[]);
      setStages((st.data ?? []).map((x: any) => ({ id: x.id, name: x.stage_name })));
      setClassId((cur) => cur || cl[0]?.id || "");
      setSubjectId((cur) => cur || s.data?.[0]?.id || "");
    });
  }, [accountId]);

  useEffect(() => {
    if (tab === "card") {
      setLoading(true);
      supabase.from("v_grade_report").select("*").order("exam_date", { ascending: false }).limit(500).then(({ data }) => { setCardRows(data ?? []); setLoading(false); });
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== "class" || !classId) return;
    (async () => {
      setLoading(true);
      const year = termId === "year";
      const { data: enr } = await supabase.from("class_enrollments").select("student_id, students(full_name)").eq("class_section_id", classId).eq("status", "active");
      const students = (enr ?? []).map((r: any) => ({ id: r.student_id as string, name: r.students?.full_name as string }));

      let scoreRows: any[] = []; let rankRows: any[] = [];
      if (year) {
        const [a, b] = await Promise.all([
          supabase.from("v_student_subject_year").select("student_id, subject_id, subject_year_score, terms_present").eq("class_section_id", classId),
          supabase.from("v_student_year_rank").select("student_id, year_average, rank_in_class, class_size").eq("class_section_id", classId),
        ]);
        scoreRows = (a.data ?? []).map((r: any) => ({ student_id: r.student_id, subject_id: r.subject_id, score: r.subject_year_score, present: r.terms_present, total: terms.length }));
        rankRows = (b.data ?? []).map((r: any) => ({ student_id: r.student_id, avg: r.year_average, rank: r.rank_in_class, size: r.class_size }));
      } else {
        const [a, b] = await Promise.all([
          supabase.from("v_student_subject_term").select("student_id, subject_id, subject_term_score, items_present, items_total").eq("class_section_id", classId).eq("term_id", termId),
          supabase.from("v_student_class_rank").select("student_id, term_average, rank_in_class, class_size").eq("class_section_id", classId).eq("term_id", termId),
        ]);
        scoreRows = (a.data ?? []).map((r: any) => ({ student_id: r.student_id, subject_id: r.subject_id, score: r.subject_term_score, present: r.items_present, total: r.items_total }));
        rankRows = (b.data ?? []).map((r: any) => ({ student_id: r.student_id, avg: r.term_average, rank: r.rank_in_class, size: r.class_size }));
      }

      const usedSubjects = subjects.filter((s) => scoreRows.some((r) => r.subject_id === s.id));
      let partial = false;
      const rows = students
        .map((st) => {
          const rk = rankRows.find((r) => r.student_id === st.id);
          const cells = usedSubjects.map((sj) => {
            const r = scoreRows.find((x) => x.student_id === st.id && x.subject_id === sj.id);
            if (!r) return "—";
            if (r.present < r.total) partial = true;
            return fmt(r.score) + (r.present < r.total ? " ⚠" : "");
          });
          return { name: st.name, cells, avg: rk?.avg, rank: rk ? `${rk.rank} / ${rk.size}` : "—", sortRank: rk?.rank ?? 9999 };
        })
        .sort((a, b) => a.sortRank - b.sortRank)
        .map((r) => [r.name, ...r.cells, fmt(r.avg), r.rank]);
      setClassTable({ head: ["الطالب", ...usedSubjects.map((s) => s.name), year ? "معدل السنة" : "المعدل", "الترتيب"], rows, partial });
      setLoading(false);
    })();
  }, [tab, classId, termId, subjects.length, terms.length]);

  useEffect(() => {
    if (tab !== "summary") return;
    (async () => {
      setLoading(true);
      const tid = termId === "year" ? terms[0]?.id : termId;
      if (!tid) { setSummary({ classRows: [], school: null }); setLoading(false); return; }
      const [a, b] = await Promise.all([
        supabase.from("v_class_term_summary").select("class_section_id, stage_id, class_average, rank_in_stage").eq("term_id", tid),
        supabase.from("v_school_term_summary").select("school_average, student_count").eq("term_id", tid).eq("account_id", accountId).maybeSingle(),
      ]);
      setSummary({ classRows: a.data ?? [], school: b.data ?? null });
      setLoading(false);
    })();
  }, [tab, termId, terms.length]);

  useEffect(() => {
    if (tab !== "weights" || !classId || !subjectId) return;
    supabase.rpc("effective_weights_report", { p_class: classId, p_subject: subjectId }).then(({ data }) => setWeights(data ?? []));
  }, [tab, classId, subjectId]);

  const tabBtn = (id: Tab, label: string) => (
    <button onClick={() => setTab(id)} className="btn"
      style={{ background: tab === id ? "var(--indigo)" : "white", color: tab === id ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>{label}</button>
  );
  const termSelect = (allowYear: boolean) => (
    <div><label style={lbl}>الفترة</label>
      <select className="input" value={termId} onChange={(e) => setTermId(e.target.value)}>
        {allowYear && <option value="year">السنة كاملة</option>}
        {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></div>
  );
  const classSelect = (
    <div><label style={lbl}>الشعبة</label>
      <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
        {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></div>
  );

  const cardFiltered = cardRows.filter((r) => !search || String(r.student_name ?? "").includes(search) || String(r.class_name ?? "").includes(search) || String(r.subject_name ?? "").includes(search));

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {tabBtn("final", "الشهادة النهائية")}{tabBtn("class", "معدلات الصف")}{tabBtn("summary", "ملخص الصفوف والمدرسة")}{tabBtn("weights", "الأوزان المطبَّقة")}{tabBtn("card", "بطاقة العلامات")}
      </div>
      {loading && <p style={{ color: "var(--steel)", fontSize: "0.85rem" }}>جارٍ التحميل...</p>}

      {tab === "final" && <ReportCard accountId={accountId} />}

      {tab === "class" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            {classSelect}{termSelect(true)}
            {classTable && classTable.rows.length > 0 && (
              <button className="btn btn-secondary" onClick={() => downloadCsv("class-report.csv", [classTable.head, ...classTable.rows])}>تصدير CSV</button>
            )}
          </div>
          {classTable && classTable.partial && (
            <p style={{ fontSize: "0.8rem", color: "var(--gold-dark)", marginBottom: 8 }}>⚠ المعدل مؤقت: بعض بنود التقييم لم تُدخَل/تُعتمد علاماتها بعد، والمعدل محسوب على الموجود فقط.</p>
          )}
          {classTable && classTable.rows.length > 0 ? (
            <ClassTable head={classTable.head} rows={classTable.rows} />
          ) : !loading && <p style={{ color: "var(--steel)" }}>لا توجد معدلات بعد — تظهر بعد إدخال علامات مؤكَّدة لامتحانات مرتبطة ببنود التقييم.</p>}
        </>
      )}

      {tab === "summary" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-end" }}>{termSelect(false)}</div>
          {summary?.school && (
            <p style={{ fontSize: "0.9rem", marginBottom: 10 }}>
              معدل المدرسة (ضمن ما تملك صلاحية رؤيته): <b>{fmt(summary.school.school_average)}</b> — عدد الطلاب: <b>{summary.school.student_count}</b>
            </p>
          )}
          {summary && summary.classRows.length > 0 ? (
            <SimpleTable
              columns={[{ key: "class", label: "الشعبة" }, { key: "stage", label: "المرحلة" }, { key: "avg", label: "معدل الشعبة" }, { key: "rank", label: "ترتيبها بالمرحلة" }]}
              rows={summary.classRows.map((r) => ({
                class: classes.find((c) => c.id === r.class_section_id)?.name ?? "—",
                stage: stages.find((s) => s.id === r.stage_id)?.name ?? "—",
                avg: fmt(r.class_average), rank: r.rank_in_stage,
              }))}
            />
          ) : !loading && <p style={{ color: "var(--steel)" }}>لا توجد بيانات لهذه الفترة بعد.</p>}
        </>
      )}

      {tab === "weights" && (
        <>
          <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 10 }}>
            الأوزان التي يُحسب بها معدل هذه المادة في هذه الشعبة فعلياً، ومن أين جاء كل وزن (الافتراضي أو تجاوز مرحلة/صف/مادة). وزن 0 = بند غير مفعّل.
          </p>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            {classSelect}
            <div><label style={lbl}>المادة</label>
              <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
          {weights.length > 0 ? (() => {
            const termSum = new Map<string, number>(); const itemSum = new Map<string, number>();
            const seenT = new Set<string>();
            weights.forEach((w) => {
              if (!seenT.has(w.term_id)) { seenT.add(w.term_id); termSum.set("all", (termSum.get("all") ?? 0) + Number(w.term_effective ?? 0)); }
              itemSum.set(w.term_id, (itemSum.get(w.term_id) ?? 0) + Number(w.item_effective ?? 0));
            });
            return (
              <div className="card" style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>الفصل</th><th>وزنه بالسنة</th><th>البند</th><th>الافتراضي</th><th>الفعلي</th><th>النسبة</th><th>المصدر</th></tr></thead>
                  <tbody>
                    {weights.map((w, i) => {
                      const firstOfTerm = i === 0 || weights[i - 1].term_id !== w.term_id;
                      return (
                        <tr key={w.item_id}>
                          <td style={{ fontWeight: 700 }}>{firstOfTerm ? w.term_name : ""}</td>
                          <td>{firstOfTerm ? `${fmt(termSum.get("all") ? (Number(w.term_effective) / (termSum.get("all") as number)) * 100 : 0)}% (${SOURCE_LABEL[w.term_source] ?? w.term_source})` : ""}</td>
                          <td>{w.item_name}</td>
                          <td>{fmt(w.item_default)}</td>
                          <td style={{ color: Number(w.item_effective) === 0 ? "var(--red)" : undefined }}>{fmt(w.item_effective)}{Number(w.item_effective) === 0 ? " (غير مفعّل)" : ""}</td>
                          <td>{itemSum.get(w.term_id) ? fmt((Number(w.item_effective) / (itemSum.get(w.term_id) as number)) * 100) + "%" : "—"}</td>
                          <td>{SOURCE_LABEL[w.item_source] ?? w.item_source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })() : <p style={{ color: "var(--steel)" }}>لا يوجد هيكل أكاديمي بعد — أنشئه من "الهيكل الأكاديمي".</p>}
        </>
      )}

      {tab === "card" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-end" }}>
            <div><label style={lbl}>بحث (طالب / صف / مادة)</label><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            {cardFiltered.length > 0 && (
              <button className="btn btn-secondary" onClick={() => downloadCsv("grades.csv", [
                ["الصف", "المادة", "الامتحان", "الطالب", "العلامة", "النسبة", "الحالة"],
                ...cardFiltered.map((r) => [r.class_name, r.subject_name, r.exam_name, r.student_name, r.score, r.percentage, r.passing_status]),
              ])}>تصدير CSV</button>
            )}
          </div>
          <SimpleTable
            columns={[
              { key: "class_name", label: "الصف" }, { key: "subject_name", label: "المادة" }, { key: "exam_name", label: "الامتحان" },
              { key: "student_name", label: "الطالب" }, { key: "score", label: "العلامة" }, { key: "percentage", label: "النسبة" }, { key: "passing_status", label: "الحالة" },
            ]}
            rows={cardFiltered}
          />
        </>
      )}
    </div>
  );
}
