"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import SimpleTable from "./SimpleTable";

export default function ReportsPanel() {
  const [view, setView] = useState<"report" | "ranking">("report");
  const [reportRows, setReportRows] = useState<Record<string, any>[]>([]);
  const [rankingRows, setRankingRows] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    if (view === "report") {
      supabase.from("v_grade_report").select("*").limit(200)
        .then(({ data }) => setReportRows(data ?? []));
    } else {
      supabase.from("v_student_class_rank").select("*").limit(200)
        .then(({ data }) => setRankingRows(data ?? []));
    }
  }, [view]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setView("report")} className="btn"
          style={{ background: view === "report" ? "var(--indigo)" : "white", color: view === "report" ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>
          بطاقة العلامات
        </button>
        <button onClick={() => setView("ranking")} className="btn"
          style={{ background: view === "ranking" ? "var(--indigo)" : "white", color: view === "ranking" ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>
          المراتب (يتطلب ترقية 04/05)
        </button>
      </div>

      {view === "report" ? (
        <SimpleTable
          columns={[
            { key: "class_name", label: "الصف" },
            { key: "subject_name", label: "المادة" },
            { key: "exam_name", label: "الامتحان" },
            { key: "student_name", label: "الطالب" },
            { key: "score", label: "العلامة" },
            { key: "percentage", label: "النسبة" },
            { key: "passing_status", label: "الحالة" },
          ]}
          rows={reportRows}
        />
      ) : (
        <SimpleTable
          columns={[
            { key: "student_id", label: "الطالب" },
            { key: "class_section_id", label: "الصف" },
            { key: "term_average", label: "المعدل الفصلي" },
            { key: "rank_in_class", label: "الرتبة بالصف" },
            { key: "class_size", label: "عدد الطلاب" },
          ]}
          rows={rankingRows}
        />
      )}
    </div>
  );
}
