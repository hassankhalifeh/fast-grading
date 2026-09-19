"use client";

import { useEffect, useState } from "react";
import { useAppUser } from "@/lib/useAppUser";
import { useCapabilities } from "@/lib/useCapabilities";
import { supabase } from "@/lib/supabaseClient";
import {
  BookOpen, Layers, ListChecks, Settings, GraduationCap, Users,
  FileText, PencilLine, ShieldCheck, BarChart3, CalendarRange, Scale, UserCheck, UserPlus, Building2,
} from "lucide-react";
import SimpleTable, { Column } from "./components/SimpleTable";
import AddEntityModal, { FieldConfig } from "./components/AddEntityModal";
import GradingPolicyPanel from "./components/GradingPolicyPanel";
import AcademicStructurePanel from "./components/AcademicStructurePanel";
import WeightsPanel from "./components/WeightsPanel";
import ScopesPanel from "./components/ScopesPanel";
import TeacherAssignmentsPanel from "./components/TeacherAssignmentsPanel";
import UsersPanel from "./components/UsersPanel";
import OrgStructurePanel from "./components/OrgStructurePanel";
import PermissionsMatrix from "./components/PermissionsMatrix";
import ExamTypeComponentsModal from "./components/ExamTypeComponentsModal";
import GradeEntryPanel from "./components/GradeEntryPanel";
import ReportsPanel from "./components/ReportsPanel";

type Section = "subjects" | "stages" | "examTypes" | "academic" | "weights" | "teachers" | "users" | "org" | "gradingPolicy" | "classSections" | "students" | "exams" | "gradeEntry" | "permissions" | "reports";

const SECTIONS: { id: Section; label: string; icon: any; capability?: string }[] = [
  { id: "subjects", label: "المواد", icon: BookOpen, capability: "config.manage" },
  { id: "stages", label: "المراحل", icon: Layers, capability: "config.manage" },
  { id: "examTypes", label: "قوالب الاختبارات", icon: ListChecks, capability: "config.manage" },
  { id: "academic", label: "الهيكل الأكاديمي", icon: CalendarRange, capability: "config.manage" },
  { id: "gradingPolicy", label: "سياسة العلامات", icon: Settings, capability: "config.manage" },
  { id: "weights", label: "المعدلات والأوزان", icon: Scale, capability: "grading.adjust" },
  { id: "classSections", label: "الصفوف", icon: GraduationCap, capability: "roster.manage" },
  { id: "students", label: "الطلاب", icon: Users, capability: "roster.manage" },
  { id: "teachers", label: "إسناد الأساتذة", icon: UserCheck, capability: "roster.manage" },
  { id: "exams", label: "الامتحانات", icon: FileText, capability: "config.manage" },
  { id: "gradeEntry", label: "إدخال العلامات", icon: PencilLine, capability: "grades.enter" },
  { id: "org", label: "الهيكل التنظيمي", icon: Building2, capability: "roster.manage" },
  { id: "users", label: "المستخدمون", icon: UserPlus, capability: "users.manage" },
  { id: "permissions", label: "الصلاحيات", icon: ShieldCheck, capability: "users.manage" },
  { id: "reports", label: "التقارير", icon: BarChart3, capability: "reports.view" },
];

const SIMPLE_SECTIONS: Partial<Record<Section, { table: string; columns: Column[] }>> = {
  subjects: { table: "subjects", columns: [{ key: "name", label: "اسم المادة" }] },
  stages: { table: "stages", columns: [{ key: "stage_name", label: "اسم المرحلة" }, { key: "order_index", label: "الترتيب" }] },
  examTypes: {
    table: "exam_types",
    columns: [{ key: "name", label: "اسم القالب" }],
  },
  classSections: {
    table: "class_sections",
    columns: [{ key: "name", label: "الاسم" }, { key: "grade_level", label: "المستوى" }, { key: "section_label", label: "الشعبة" }],
  },
  students: { table: "students", columns: [{ key: "full_name", label: "اسم الطالب" }, { key: "parent_phone", label: "هاتف ولي الأمر" }] },
  exams: {
    table: "exams",
    columns: [{ key: "exam_name", label: "الاسم" }, { key: "exam_date", label: "التاريخ" }, { key: "grading_window_open", label: "النافذة مفتوحة" }],
  },
};

export default function DashboardPage() {
  const { appUser, loading } = useAppUser();
  const capabilities = useCapabilities(appUser);

  const [section, setSection] = useState<Section>("subjects");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [componentsModalExam, setComponentsModalExam] = useState<{ id: string; name: string } | null>(null);

  const [refSubjects, setRefSubjects] = useState<{ value: string; label: string }[]>([]);
  const [refStages, setRefStages] = useState<{ value: string; label: string }[]>([]);
  const [refExamTypes, setRefExamTypes] = useState<{ value: string; label: string }[]>([]);
  const [refClassSections, setRefClassSections] = useState<{ value: string; label: string }[]>([]);
  const [refItems, setRefItems] = useState<{ value: string; label: string }[]>([]);

  function loadRows() {
    const cfg = SIMPLE_SECTIONS[section];
    if (!cfg || !appUser) return;
    supabase.from(cfg.table).select("*").eq("account_id", appUser.account_id)
      .then(({ data }) => setRows(data ?? []));
  }

  useEffect(() => { loadRows(); }, [section, appUser]);

  useEffect(() => {
    if (!appUser) return;
    supabase.from("subjects").select("id, name").eq("account_id", appUser.account_id)
      .then(({ data }) => setRefSubjects((data ?? []).map((s) => ({ value: s.id, label: s.name }))));
    supabase.from("stages").select("id, stage_name").eq("account_id", appUser.account_id)
      .then(({ data }) => setRefStages((data ?? []).map((s) => ({ value: s.id, label: s.stage_name }))));
    supabase.from("exam_types").select("id, name").eq("account_id", appUser.account_id)
      .then(({ data }) => setRefExamTypes((data ?? []).map((s) => ({ value: s.id, label: s.name }))));
    supabase.from("class_sections").select("id, name").eq("account_id", appUser.account_id)
      .then(({ data }) => setRefClassSections((data ?? []).map((s) => ({ value: s.id, label: s.name }))));
    Promise.all([
      supabase.from("terms").select("id, name, order_index").eq("account_id", appUser.account_id),
      supabase.from("assessment_items").select("id, name, term_id, order_index").eq("account_id", appUser.account_id),
    ]).then(([t, i]) => {
      const terms = t.data ?? [];
      const list = (i.data ?? [])
        .map((it: any) => ({ it, term: terms.find((x: any) => x.id === it.term_id) }))
        .sort((a: any, b: any) => (a.term?.order_index ?? 0) - (b.term?.order_index ?? 0) || a.it.order_index - b.it.order_index)
        .map(({ it, term }: any) => ({ value: it.id, label: `${term?.name ?? ""} — ${it.name}` }));
      setRefItems(list);
    });
  }, [appUser, rows]);

  if (loading || capabilities === null) return <p style={{ padding: 24, color: "var(--steel)" }}>جارٍ التحميل...</p>;
  if (!appUser) return <p style={{ padding: 24, color: "var(--steel)" }}>الرجاء تسجيل الدخول.</p>;

  const visibleSections = SECTIONS.filter((s) => !s.capability || capabilities.size === 0 || capabilities.has(s.capability));

  const FIELD_CONFIGS: Partial<Record<Section, FieldConfig[]>> = {
    subjects: [{ key: "name", label: "اسم المادة", type: "text", required: true }],
    stages: [
      { key: "stage_name", label: "اسم المرحلة", type: "text", required: true },
      { key: "order_index", label: "ترتيب العرض", type: "number", required: true },
    ],
    examTypes: [
      { key: "name", label: "اسم القالب (مثلاً: تحريري + شفهي)", type: "text", required: true },
    ],
    classSections: [
      { key: "name", label: "اسم الصف", type: "text", required: true, placeholder: "مثلاً: الصف الثامن" },
      { key: "grade_level", label: "المستوى الدراسي", type: "text" },
      { key: "section_label", label: "الشعبة", type: "text", placeholder: "أ / ب / ج" },
      { key: "stage_id", label: "المرحلة", type: "select", options: refStages },
    ],
    students: [
      { key: "full_name", label: "اسم الطالب", type: "text", required: true },
      { key: "parent_name", label: "اسم ولي الأمر", type: "text" },
      { key: "parent_phone", label: "هاتف ولي الأمر", type: "text" },
      { key: "parent_email", label: "بريد ولي الأمر", type: "text" },
      { key: "enroll_class_id", label: "تسجيله بالصف", type: "select", options: refClassSections },
    ],
    exams: [
      { key: "exam_name", label: "اسم الامتحان", type: "text", required: true },
      { key: "exam_date", label: "التاريخ", type: "date", required: true },
      { key: "class_section_id", label: "الصف", type: "select", required: true, options: refClassSections },
      { key: "subject_id", label: "المادة", type: "select", required: true, options: refSubjects },
      { key: "item_id", label: "بند التقييم (الفصل — السعي/الامتحان)", type: "select", required: true, options: refItems },
      { key: "exam_type_id", label: "قالب علامات الاختبار (اختياري)", type: "select", options: refExamTypes },
      { key: "max_score", label: "العلامة القصوى", type: "number" },
    ],
  };

  const fields = FIELD_CONFIGS[section];

  async function handleAddSubmit(values: Record<string, any>) {
    const cfg = SIMPLE_SECTIONS[section];
    if (!cfg || !appUser) return { error: "خطأ داخلي" };

    if (section === "students") {
      const { enroll_class_id, ...studentValues } = values;
      const { data, error } = await supabase.from("students")
        .insert({ ...studentValues, account_id: appUser.account_id }).select().single();
      if (error) return { error: error.message };
      if (enroll_class_id) {
        await supabase.from("class_enrollments").insert({ class_section_id: enroll_class_id, student_id: data.id });
      }
      loadRows();
      return { error: null };
    }

    const payload: Record<string, any> = { ...values, account_id: appUser.account_id };
    if (section === "classSections") payload.created_by = appUser.id;
    if (section === "examTypes") payload.weight_percent = 0; // الوزن صار من "الهيكل الأكاديمي" (عمود قديم مطلوب بالجدول)

    const { error } = await supabase.from(cfg.table).insert(payload);
    if (error) return { error: error.message };
    loadRows();
    return { error: null };
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{ width: 235, background: "var(--indigo)", padding: "1.5rem 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 1.25rem", marginBottom: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <GraduationCap size={17} color="white" />
          </div>
          <p style={{ color: "white", fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>Grading SaaS</p>
        </div>
        {visibleSections.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} className={`nav-item ${section === s.id ? "active" : ""}`}>
            <s.icon size={17} />{s.label}
          </button>
        ))}
      </nav>

      <main className="fade-in" style={{ flex: 1, padding: "1.75rem", maxWidth: 1100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ fontSize: "1.3rem", margin: 0, color: "var(--indigo)" }}>
            {SECTIONS.find((s) => s.id === section)?.label}
          </h2>
          {fields && (
            <button onClick={() => setShowAddModal(true)} className="btn btn-gold">+ إضافة جديد</button>
          )}
        </div>
        <div className="grade-underline" style={{ marginBottom: 18 }} />

        {section === "gradingPolicy" && <GradingPolicyPanel accountId={appUser.account_id} />}
        {section === "teachers" && (
          <TeacherAssignmentsPanel accountId={appUser.account_id} appUser={appUser} canApprove={capabilities.has("teaching.approve_secondary")} />
        )}
        {section === "org" && <OrgStructurePanel accountId={appUser.account_id} appUser={appUser} />}
        {section === "users" && <UsersPanel appUser={appUser} />}
        {section === "academic" && <AcademicStructurePanel accountId={appUser.account_id} />}
        {section === "weights" && <WeightsPanel accountId={appUser.account_id} appUser={appUser} />}
        {section === "permissions" && (
          <>
            <PermissionsMatrix accountId={appUser.account_id} />
            <ScopesPanel accountId={appUser.account_id} appUser={appUser} />
          </>
        )}
        {section === "reports" && <ReportsPanel />}
        {section === "gradeEntry" && (
          <GradeEntryPanel accountId={appUser.account_id} appUser={appUser} canToggleWindow={capabilities.has("window.toggle")} />
        )}

        {SIMPLE_SECTIONS[section] && (
          <>
            <SimpleTable columns={SIMPLE_SECTIONS[section]!.columns} rows={rows} />
            {section === "examTypes" && rows.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {rows.map((r) => (
                  <button key={r.id} onClick={() => setComponentsModalExam({ id: r.id, name: r.name })}
                    className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "7px 14px" }}>
                    مكوّنات: {r.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {showAddModal && fields && (
        <AddEntityModal
          title={`إضافة ${SECTIONS.find((s) => s.id === section)?.label}`}
          fields={fields}
          onSubmit={handleAddSubmit}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {componentsModalExam && (
        <ExamTypeComponentsModal
          examTypeId={componentsModalExam.id}
          examTypeName={componentsModalExam.name}
          onClose={() => setComponentsModalExam(null)}
        />
      )}
    </div>
  );
}
