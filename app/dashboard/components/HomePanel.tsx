"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { Users, GraduationCap, PencilLine, BarChart3, Upload, Pin, PinOff, AlertTriangle, CheckCircle2, ChevronLeft } from "lucide-react";

interface PendingWork { incomplete_exams: number; uncovered_subjects: number; pending_assignment_requests: number; pending_imports: number; draft_message_batches: number; open_violations: number }
interface Subscription { ok: boolean; status: string; days_left: number | null; limits?: { classes: number; total_students: number }; usage?: { classes: number; students: number } }
interface AttentionItem { key: string; text: string; section: string; tone: "danger" | "warn" | "info" }
interface Shortcut { section: string; label: string; icon: any; capability?: string }
const SHORTCUTS: Shortcut[] = [
  { section: "gradeEntry", label: "إدخال العلامات", icon: PencilLine, capability: "grades.enter" },
  { section: "students", label: "الطلاب", icon: Users, capability: "roster.manage" },
  { section: "reports", label: "مركز التقارير", icon: BarChart3, capability: "reports.view" },
  { section: "import", label: "الاستيراد الجماعي", icon: Upload, capability: "records.import_manage" },
];

// الصفحة الرئيسية: ترحيب باسم المدرسة (خلفية الحساب تظهر خلف كل صفحة، تُعدَّل من «معلومات المدرسة»)،
// أرقام سريعة، واختصارات لأكثر الشاشات استعمالاً. كل مستخدم يقدر يجعل أي صفحة أخرى صفحته الافتراضية بدل هذه.
export default function HomePanel({ accountId, appUser, capabilities, features, isDefault, onSetDefault, onNavigate }: {
  accountId: string; appUser: AppUser; capabilities: Set<string>; features: Set<string>; isDefault: boolean; onSetDefault: () => void; onNavigate: (section: string) => void;
}) {
  const [schoolName, setSchoolName] = useState("");
  const [counts, setCounts] = useState<{ students: number; classes: number; openExams: number } | null>(null);
  const [work, setWork] = useState<PendingWork | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);

  useEffect(() => {
    supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle()
      .then(({ data }) => setSchoolName(data?.display_name ?? ""));
    Promise.all([
      supabase.from("students").select("id", { count: "exact", head: true }).eq("account_id", accountId),
      supabase.from("class_sections").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("is_active", true),
      supabase.from("exams").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("grading_window_open", true),
    ]).then(([s, c, e]) => setCounts({ students: s.count ?? 0, classes: c.count ?? 0, openExams: e.count ?? 0 }));
    // ما يحتاج انتباهك: فشل أي نداء (مثلاً قبل تطبيق الترحيل 54) يُخفي القسم فقط ولا يكسر الصفحة
    supabase.rpc("my_pending_work").then(({ data, error }) => setWork(error ? null : (data as PendingWork)));
    supabase.rpc("my_subscription_status").then(({ data, error }) => setSub(error ? null : (data as Subscription)));
  }, [accountId]);

  const has = (c: string) => capabilities.has(c);
  const items: AttentionItem[] = [];
  if (work) {
    if (work.incomplete_exams > 0 && (has("grades.enter") || has("grades.view_all") || has("reports.view")))
      items.push({ key: "incomplete", text: `${work.incomplete_exams} امتحان حلّ موعده وعلاماته ناقصة`, section: has("grades.enter") ? "gradeEntry" : "reports", tone: "warn" });
    if (work.pending_assignment_requests > 0 && has("teaching.approve_secondary"))
      items.push({ key: "requests", text: `${work.pending_assignment_requests} طلب إسناد أستاذ ثانٍ بانتظار موافقتك`, section: "teachers", tone: "warn" });
    if (work.uncovered_subjects > 0 && (has("users.manage") || has("config.manage")))
      items.push({ key: "uncovered", text: `${work.uncovered_subjects} صف/مادة بلا أستاذ أساسي`, section: "teachers", tone: "info" });
    if (work.pending_imports > 0 && has("records.import_manage"))
      items.push({ key: "imports", text: `${work.pending_imports} دفعة استيراد بانتظار المراجعة`, section: "import", tone: "warn" });
    if (work.draft_message_batches > 0 && features.has("whatsapp_active") && (has("notifications.send") || has("notifications.approve")))
      items.push({ key: "drafts", text: `${work.draft_message_batches} مسودة مراسلات لم تُرسل بعد`, section: "notifications", tone: "info" });
    if (work.open_violations > 0 && features.has("whatsapp_history") && has("notifications.send"))
      items.push({ key: "violations", text: `${work.open_violations} مخالفة محتوى بانتظار المراجعة`, section: "moderation", tone: "danger" });
  }
  if (sub && has("config.manage")) {
    if (sub.ok === false) items.push({ key: "sub", text: sub.status === "suspended" ? "اشتراك المدرسة موقوف: الإدخال الجديد متوقف" : "انتهى اشتراك المدرسة: الإدخال الجديد متوقف", section: "school", tone: "danger" });
    else if (sub.days_left !== null && sub.days_left !== undefined && sub.days_left <= 30)
      items.push({ key: "sub", text: `ينتهي اشتراك المدرسة بعد ${sub.days_left} يوماً`, section: "school", tone: sub.days_left <= 7 ? "danger" : "warn" });
    const lim = sub.limits, use = sub.usage;
    if (lim && use) {
      const near = [["الصفوف", use.classes, lim.classes], ["الطلاب", use.students, lim.total_students]].filter(([, u, l]) => (l as number) > 0 && (u as number) >= (l as number) * 0.9);
      if (near.length) items.push({ key: "limits", text: `اقتربتَ من حد الاشتراك: ${near.map(([n, u, l]) => `${n} ${u}/${l}`).join("، ")}`, section: "school", tone: "warn" });
    }
  }
  const toneColor = { danger: "var(--red)", warn: "var(--gold-dark)", info: "var(--steel)" } as const;

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

      {work !== null && capabilities.size > 0 && (
        <div className="card" style={{ padding: "1rem 1.2rem", marginBottom: 20 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--indigo)" }}>
            {items.length ? <AlertTriangle size={17} color="var(--gold-dark)" /> : <CheckCircle2 size={17} color="var(--green)" />} ما يحتاج انتباهك الآن
          </strong>
          {items.length === 0 ? <p style={{ margin: 0, color: "var(--green)", fontSize: "0.9rem" }}>لا شيء معلّق: كل شيء على ما يرام.</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((it) => (
                <button key={it.key} onClick={() => onNavigate(it.section)} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "start", background: "none", border: "none", borderBottom: "1px solid var(--fog)", padding: "8px 2px", cursor: "pointer", font: "inherit", color: "inherit" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: toneColor[it.tone], flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: "0.92rem" }}>{it.text}</span>
                  <ChevronLeft size={15} color="var(--steel)" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
