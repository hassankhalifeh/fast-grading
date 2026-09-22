"use client";

import { useState, type ReactElement } from "react";
import ReportsPanel from "./ReportsPanel";
import BulkCertificates from "./reports/BulkCertificates";
import SupplementaryReport from "./reports/SupplementaryReport";
import {
  PassFailReport, PendingExamsReport, TeachingCoverageReport, GradeActivityReport,
  ImportBatchesReport, UsersReport, AuditLogReport, WhatsAppSummaryReport,
} from "./reports/MoreReports";
import {
  BarChart3, Award, TrendingUp, ClipboardList, Users2, UploadCloud, ShieldCheck, History as HistoryIcon, MessageCircle, LifeBuoy,
} from "lucide-react";

interface ReportDef { id: string; label: string; hint: string; icon: any }
interface Category { id: string; label: string; icon: any; needs?: string; reports: ReportDef[] }

// دليل التقارير المتاحة، مبني على ما يوفّره البرنامج فعلياً (بلا بيانات وهمية). كل فئة تحتاج صلاحية reports.view
// إلا "إدارية" التي تحتاج config.manage/users.manage نظراً لحساسيتها (سجل التدقيق والمستخدمون).
const CATEGORIES: Category[] = [
  {
    id: "grades", label: "العلامات والمعدلات", icon: BarChart3,
    reports: [{ id: "grades", label: "بطاقة العلامات، معدلات الصف، الملخصات، الأوزان", hint: "الشاشة الكاملة الحالية للتقارير", icon: BarChart3 }],
  },
  {
    id: "certificates", label: "الشهادات", icon: Award,
    reports: [{ id: "bulk_certs", label: "شهادات دفعة صف كامل", hint: "طباعة شهادة كل طالب في الصف دفعة واحدة", icon: Award }],
  },
  {
    id: "outcomes", label: "النتائج والتحصيل", icon: TrendingUp,
    reports: [
      { id: "pass_fail", label: "النجاح والرسوب لكل مادة", hint: "عدد ونسبة الناجحين/الراسبين في كل مادة لصف", icon: TrendingUp },
      { id: "supplementary", label: "التكميلي والترفيع (كل الدور)", hint: "نتائج مواد التكميلي والترفيع عبر كل الصفوف", icon: LifeBuoy },
    ],
  },
  {
    id: "operations", label: "متابعة العمل", icon: ClipboardList,
    reports: [
      { id: "pending_exams", label: "امتحانات ناقصة العلامات", hint: "امتحانات لم تكتمل علاماتها بعد", icon: ClipboardList },
      { id: "coverage", label: "تغطية التدريس", hint: "أي صف/مادة بلا أستاذ أساسي", icon: Users2 },
      { id: "activity", label: "نشاط إدخال العلامات", hint: "من أدخل كم علامة، يدوياً أو صوتياً", icon: ClipboardList },
      { id: "imports", label: "سجل الاستيراد الجماعي", hint: "دفعات الاستيراد وحالتها", icon: UploadCloud },
    ],
  },
  {
    id: "whatsapp", label: "مراسلات واتساب", icon: MessageCircle, needs: "whatsapp_active",
    reports: [{ id: "wa_summary", label: "ملخص الرسائل", hint: "عدد الرسائل لكل نوع مراسلة وحالتها", icon: MessageCircle }],
  },
  {
    id: "admin", label: "إدارية", icon: ShieldCheck, needs: "admin",
    reports: [
      { id: "users", label: "المستخدمون والصلاحيات", hint: "الأدوار والحالة وعدد الصلاحيات", icon: Users2 },
      { id: "audit", label: "سجل التدقيق", hint: "من عدّل ماذا ومتى (آخر 500 عملية)", icon: HistoryIcon },
    ],
  },
];

export default function ReportsHub({ accountId, capabilities, features }: { accountId: string; capabilities: Set<string>; features: Set<string> }) {
  const isAdmin = capabilities.has("config.manage") || capabilities.has("users.manage");
  const categories = CATEGORIES
    .filter((c) => c.needs !== "whatsapp_active" || features.has("whatsapp_active"))
    .filter((c) => c.needs !== "admin" || isAdmin);

  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [repId, setRepId] = useState(categories[0]?.reports[0]?.id ?? "");
  const cat = categories.find((c) => c.id === catId) ?? categories[0];

  function pick(c: Category, r: ReportDef) { setCatId(c.id); setRepId(r.id); }

  const content: Record<string, ReactElement> = {
    grades: <ReportsPanel accountId={accountId} />,
    bulk_certs: <BulkCertificates accountId={accountId} />,
    pass_fail: <PassFailReport accountId={accountId} />,
    supplementary: <SupplementaryReport accountId={accountId} />,
    pending_exams: <PendingExamsReport accountId={accountId} />,
    coverage: <TeachingCoverageReport accountId={accountId} />,
    activity: <GradeActivityReport accountId={accountId} />,
    imports: <ImportBatchesReport accountId={accountId} />,
    wa_summary: <WhatsAppSummaryReport accountId={accountId} />,
    users: <UsersReport accountId={accountId} />,
    audit: <AuditLogReport accountId={accountId} />,
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="card" style={{ width: 260, flexShrink: 0, padding: "0.6rem 0" }}>
        {categories.map((c) => (
          <div key={c.id} style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 800, color: "var(--indigo)" }}>
              <c.icon size={15} /> {c.label}
            </div>
            {c.reports.map((r) => (
              <button key={r.id} onClick={() => pick(c, r)} title={r.hint} style={{
                display: "block", width: "100%", textAlign: "start", padding: "7px 14px 7px 30px", border: "none", cursor: "pointer",
                background: repId === r.id ? "var(--fog)" : "transparent", fontSize: "0.83rem", color: repId === r.id ? "var(--indigo)" : "var(--charcoal)",
                fontWeight: repId === r.id ? 700 : 400, borderInlineStart: repId === r.id ? "3px solid var(--gold)" : "3px solid transparent",
              }}>
                {r.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 320 }}>
        <h3 style={{ marginTop: 0 }}>{cat?.reports.find((r) => r.id === repId)?.label}</h3>
        {content[repId] ?? <p style={{ color: "var(--steel)" }}>اختر تقريراً من القائمة.</p>}
      </div>
    </div>
  );
}
