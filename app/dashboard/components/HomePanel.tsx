"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Users, GraduationCap, FileText, PencilLine, BarChart3, Upload, Pin, PinOff } from "lucide-react";

interface Shortcut { section: string; label: string; icon: any; capability?: string }
const SHORTCUTS: Shortcut[] = [
  { section: "gradeEntry", label: "إدخال العلامات", icon: PencilLine, capability: "grades.enter" },
  { section: "students", label: "الطلاب", icon: Users, capability: "roster.manage" },
  { section: "reports", label: "مركز التقارير", icon: BarChart3, capability: "reports.view" },
  { section: "import", label: "الاستيراد الجماعي", icon: Upload, capability: "records.import_manage" },
];

// الصفحة الرئيسية: ترحيب باسم المدرسة (خلفية الحساب تظهر خلف كل صفحة، تُعدَّل من «معلومات المدرسة»)،
// أرقام سريعة، واختصارات لأكثر الشاشات استعمالاً. كل مستخدم يقدر يجعل أي صفحة أخرى صفحته الافتراضية بدل هذه.
export default function HomePanel({ accountId, appUser, capabilities, isDefault, onSetDefault, onNavigate }: {
  accountId: string; appUser: AppUser; capabilities: Set<string>; isDefault: boolean; onSetDefault: () => void; onNavigate: (section: string) => void;
}) {
  const [schoolName, setSchoolName] = useState("");
  const [counts, setCounts] = useState<{ students: number; classes: number; openExams: number } | null>(null);

  useEffect(() => {
    supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle()
      .then(({ data }) => setSchoolName(data?.display_name ?? ""));
    Promise.all([
      supabase.from("students").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("class_sections").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("exams").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("grading_window_open", true),
    ]).then(([s, c, e]) => setCounts({ students: s.count ?? 0, classes: c.count ?? 0, openExams: e.count ?? 0 }));
  }, [accountId]);

  const stat = (n: number | undefined, label: string) => (
    <div className="card" style={{ padding: "0.9rem 1.1rem", minWidth: 120 }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--indigo)" }}>{n ?? "—"}</div>
      <div style={{ fontSize: "0.8rem", color: "var(--steel)" }}>{label}</div>
    </div>
  );

  return (
    <div>
      <div className="card" style={{ padding: "1.4rem 1.6rem", marginBottom: 18, display: "flex", alignItems: "center", gap: 16, background: "var(--indigo)", color: "white" }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <GraduationCap size={28} color="white" />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>أهلاً {appUser.full_name}</p>
          <p style={{ margin: "4px 0 0", opacity: 0.85, fontSize: "0.95rem" }}>{schoolName || "لوحة التحكم"}</p>
        </div>
        <button onClick={onSetDefault} disabled={isDefault} className="btn btn-secondary" style={{ marginInlineStart: "auto", fontSize: "0.78rem", padding: "6px 12px", opacity: isDefault ? 0.7 : 1 }}>
          {isDefault ? <><Pin size={13} /> صفحتك الافتراضية</> : <><PinOff size={13} /> اجعلها صفحتي الافتراضية</>}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {stat(counts?.students, "الطلاب")}
        {stat(counts?.classes, "الصفوف")}
        {stat(counts?.openExams, "امتحانات مفتوحة للعلامات")}
      </div>

      <strong style={{ display: "block", marginBottom: 10, color: "var(--indigo)" }}>اختصارات</strong>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {SHORTCUTS.filter((s) => !s.capability || capabilities.size === 0 || capabilities.has(s.capability)).map((s) => (
          <button key={s.section} onClick={() => onNavigate(s.section)} className="btn btn-secondary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <s.icon size={15} /> {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
