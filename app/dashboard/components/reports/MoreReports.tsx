"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { downloadCsv } from "@/lib/reportsCsv";
import SimpleTable from "../SimpleTable";

interface Named { id: string; name: string }
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 10) / 10));
const btnRow = { display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" as const, alignItems: "flex-end" as const };

function Toolbar({ children, onExport, disabled }: { children?: React.ReactNode; onExport?: () => void; disabled?: boolean }) {
  return (
    <div style={btnRow}>
      {children}
      {onExport && <button className="btn btn-secondary" disabled={disabled} onClick={onExport}>تصدير CSV</button>}
    </div>
  );
}

// ============================================================ 1) النجاح والرسوب
export function PassFailReport({ accountId }: { accountId: string }) {
  const [classes, setClasses] = useState<Named[]>([]);
  const [terms, setTerms] = useState<Named[]>([]);
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("year");
  const [pass, setPass] = useState(50);
  const [rows, setRows] = useState<{ subject: string; total: number; passed: number; failed: number; avg: number | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("terms").select("id, name, order_index").eq("account_id", accountId).order("order_index"),
      supabase.from("grading_policies").select("passing_threshold_percent").eq("account_id", accountId).maybeSingle(),
    ]).then(([c, t, gp]) => {
      setClasses((c.data ?? []) as Named[]); setTerms((t.data ?? []) as Named[]);
      setClassId((cur) => cur || c.data?.[0]?.id || "");
      if (gp.data?.passing_threshold_percent != null) setPass(Number(gp.data.passing_threshold_percent));
    });
  }, [accountId]);

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    (async () => {
      const year = termId === "year";
      const [scores, subjects] = await Promise.all([
        year
          ? supabase.from("v_student_subject_year").select("subject_id, subject_year_score").eq("class_section_id", classId)
          : supabase.from("v_student_subject_term").select("subject_id, subject_term_score").eq("class_section_id", classId).eq("term_id", termId),
        supabase.from("subjects").select("id, name").eq("account_id", accountId),
      ]);
      const subjName = new Map((subjects.data ?? []).map((s: any) => [s.id, s.name]));
      const acc = new Map<string, { total: number; passed: number; sum: number }>();
      (scores.data ?? []).forEach((r: any) => {
        const score = year ? r.subject_year_score : r.subject_term_score;
        if (score === null) return;
        const cur = acc.get(r.subject_id) ?? { total: 0, passed: 0, sum: 0 };
        cur.total++; cur.sum += Number(score); if (Number(score) >= pass) cur.passed++;
        acc.set(r.subject_id, cur);
      });
      setRows([...acc.entries()].map(([sid, v]) => ({
        subject: subjName.get(sid) ?? "—", total: v.total, passed: v.passed, failed: v.total - v.passed, avg: v.total ? v.sum / v.total : null,
      })).sort((a, b) => a.subject.localeCompare(b.subject, "ar")));
      setLoading(false);
    })();
  }, [classId, termId, pass, accountId]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>عدد ونسبة الناجحين والراسبين في كل مادة لشعبة معيّنة، حسب حد النجاح ({pass}%).</p>
      <Toolbar onExport={() => downloadCsv("pass-fail.csv", [["المادة", "العدد", "ناجح", "راسب", "نسبة النجاح%", "المعدل"], ...rows.map((r) => [r.subject, r.total, r.passed, r.failed, r.total ? fmt((r.passed / r.total) * 100) : "—", fmt(r.avg)])])} disabled={rows.length === 0}>
        <div><label style={lbl}>الشعبة</label><select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label style={lbl}>الفترة</label><select className="input" value={termId} onChange={(e) => setTermId(e.target.value)}><option value="year">السنة كاملة</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </Toolbar>
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "subject", label: "المادة" }, { key: "total", label: "العدد" }, { key: "passed", label: "ناجح" }, { key: "failed", label: "راسب" }, { key: "rate", label: "نسبة النجاح" }, { key: "avg", label: "المعدل" }]}
          rows={rows.map((r) => ({ subject: r.subject, total: r.total, passed: r.passed, failed: r.failed, rate: r.total ? fmt((r.passed / r.total) * 100) + "%" : "—", avg: fmt(r.avg) }))} />
      )}
    </div>
  );
}

// ============================================================ 2) امتحانات ناقصة العلامات
export function PendingExamsReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<{ id: string; label: string; date: string | null; enrolled: number; graded: number; locked: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyPending, setOnlyPending] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: exams } = await supabase.from("exams")
        .select("id, exam_name, exam_date, is_locked_by_admin, class_section_id, class_sections(name), subjects(name)")
        .eq("account_id", accountId).order("exam_date", { ascending: false }).limit(300);
      const list = (exams ?? []) as any[];
      const [enr, gr] = await Promise.all([
        supabase.from("class_enrollments").select("class_section_id, status"),
        supabase.from("grades").select("exam_id"),
      ]);
      const enrCount = new Map<string, number>();
      (enr.data ?? []).forEach((r: any) => { if (r.status === "active") enrCount.set(r.class_section_id, (enrCount.get(r.class_section_id) ?? 0) + 1); });
      const gradedCount = new Map<string, number>();
      (gr.data ?? []).forEach((r: any) => gradedCount.set(r.exam_id, (gradedCount.get(r.exam_id) ?? 0) + 1));
      setRows(list.map((e) => ({
        id: e.id, label: `${e.class_sections?.name ?? "—"} · ${e.subjects?.name ?? "—"} · ${e.exam_name}`, date: e.exam_date,
        enrolled: enrCount.get(e.class_section_id) ?? 0, graded: gradedCount.get(e.id) ?? 0, locked: !!e.is_locked_by_admin,
      })));
      setLoading(false);
    })();
  }, [accountId]);

  const shown = rows.filter((r) => !onlyPending || r.graded < r.enrolled);
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>امتحانات لم تكتمل علاماتها بعد (عدد العلامات المُدخلة أقل من عدد طلاب الشعبة).</p>
      <Toolbar onExport={() => downloadCsv("pending-exams.csv", [["الامتحان", "التاريخ", "الطلاب", "علامات مُدخلة", "الحالة"], ...shown.map((r) => [r.label, r.date ?? "", r.enrolled, r.graded, r.locked ? "مقفل" : "مفتوح"])])} disabled={shown.length === 0}>
        <label style={{ fontSize: "0.85rem" }}><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> الناقصة فقط</label>
      </Toolbar>
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "label", label: "الامتحان" }, { key: "date", label: "التاريخ" }, { key: "enrolled", label: "الطلاب" }, { key: "graded", label: "علامات مُدخلة" }, { key: "status", label: "الحالة" }]}
          rows={shown.map((r) => ({ label: r.label, date: r.date ?? "—", enrolled: r.enrolled, graded: r.graded, status: r.graded >= r.enrolled && r.enrolled > 0 ? "مكتمل" : r.locked ? "مقفل وناقص" : "ناقص" }))} />
      )}
    </div>
  );
}

// ============================================================ 3) تغطية التدريس
export function TeachingCoverageReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<{ cls: string; subject: string; teacher: string | null }[]>([]);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [classes, subjects, assigns] = await Promise.all([
        supabase.from("class_sections").select("id, name").eq("account_id", accountId).eq("is_active", true).order("name"),
        supabase.from("subjects").select("id, name").eq("account_id", accountId).order("name"),
        supabase.from("class_subject_teachers").select("class_section_id, subject_id, app_users!teacher_id(full_name)").eq("assignment_role", "primary"),
      ]);
      const teacherOf = new Map<string, string>();
      (assigns.data ?? []).forEach((a: any) => teacherOf.set(`${a.class_section_id}:${a.subject_id}`, a.app_users?.full_name ?? "—"));
      const out: { cls: string; subject: string; teacher: string | null }[] = [];
      (classes.data ?? []).forEach((c: any) => (subjects.data ?? []).forEach((s: any) => out.push({ cls: c.name, subject: s.name, teacher: teacherOf.get(`${c.id}:${s.id}`) ?? null })));
      setRows(out);
      setLoading(false);
    })();
  }, [accountId]);

  const shown = rows.filter((r) => !onlyMissing || !r.teacher);
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>هل لكل صف ومادة أستاذ أساسي مُسنَد إليه؟</p>
      <Toolbar onExport={() => downloadCsv("teaching-coverage.csv", [["الصف", "المادة", "الأستاذ"], ...shown.map((r) => [r.cls, r.subject, r.teacher ?? "بلا أستاذ"])])} disabled={shown.length === 0}>
        <label style={{ fontSize: "0.85rem" }}><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> بلا أستاذ فقط</label>
      </Toolbar>
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "cls", label: "الصف" }, { key: "subject", label: "المادة" }, { key: "teacher", label: "الأستاذ" }]}
          rows={shown.map((r) => ({ cls: r.cls, subject: r.subject, teacher: r.teacher ?? "بلا أستاذ" }))} />
      )}
    </div>
  );
}

// ============================================================ 4) نشاط إدخال العلامات
export function GradeActivityReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<{ name: string; count: number; manual: number; voice: number; last: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [grades, users] = await Promise.all([
        supabase.from("grades").select("entered_by, entry_method, created_at, exams!inner(account_id)").eq("exams.account_id", accountId).limit(20000),
        supabase.from("app_users").select("id, full_name").eq("account_id", accountId),
      ]);
      const names = new Map((users.data ?? []).map((u: any) => [u.id, u.full_name]));
      const acc = new Map<string, { count: number; manual: number; voice: number; last: string }>();
      (grades.data ?? []).forEach((g: any) => {
        const cur = acc.get(g.entered_by) ?? { count: 0, manual: 0, voice: 0, last: g.created_at };
        cur.count++; if (g.entry_method === "voice") cur.voice++; else cur.manual++;
        if (g.created_at > cur.last) cur.last = g.created_at;
        acc.set(g.entered_by, cur);
      });
      setRows([...acc.entries()].map(([uid, v]) => ({ name: names.get(uid) ?? "مستخدم محذوف", count: v.count, manual: v.manual, voice: v.voice, last: v.last }))
        .sort((a, b) => b.count - a.count));
      setLoading(false);
    })();
  }, [accountId]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>عدد العلامات التي أدخلها كل مستخدم، يدوياً أو صوتياً، وآخر إدخال له.</p>
      <Toolbar onExport={() => downloadCsv("grade-activity.csv", [["المستخدم", "المجموع", "يدوي", "صوتي", "آخر إدخال"], ...rows.map((r) => [r.name, r.count, r.manual, r.voice, r.last ? new Date(r.last).toLocaleString("ar") : ""])])} disabled={rows.length === 0} />
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "name", label: "المستخدم" }, { key: "count", label: "المجموع" }, { key: "manual", label: "يدوي" }, { key: "voice", label: "صوتي" }, { key: "last", label: "آخر إدخال" }]}
          rows={rows.map((r) => ({ ...r, last: r.last ? new Date(r.last).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "—" }))} />
      )}
    </div>
  );
}

// ============================================================ 5) سجل الاستيراد الجماعي
const IMPORT_STATUS: Record<string, string> = { pending_review: "بانتظار المراجعة", committed: "اعتُمد", cancelled: "أُلغي" };
const IMPORT_ENTITY: Record<string, string> = { student: "طلاب", teacher: "أساتذة", class: "صفوف" };
export function ImportBatchesReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [batches, users] = await Promise.all([
        supabase.from("import_batches").select("*").eq("account_id", accountId).order("created_at", { ascending: false }),
        supabase.from("app_users").select("id, full_name").eq("account_id", accountId),
      ]);
      const names = new Map((users.data ?? []).map((u: any) => [u.id, u.full_name]));
      setRows((batches.data ?? []).map((b: any) => ({ ...b, uploader: names.get(b.uploaded_by) ?? "—" })));
      setLoading(false);
    })();
  }, [accountId]);
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>كل دفعات الاستيراد الجماعي وحالتها ومن رفعها.</p>
      <Toolbar onExport={() => downloadCsv("import-batches.csv", [["الملف", "النوع", "الحالة", "رفعه", "بتاريخ", "اعتُمد بتاريخ"], ...rows.map((r) => [r.file_name, IMPORT_ENTITY[r.entity_type] ?? r.entity_type, IMPORT_STATUS[r.status] ?? r.status, r.uploader, r.created_at, r.committed_at ?? ""])])} disabled={rows.length === 0} />
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "file_name", label: "الملف" }, { key: "entity", label: "النوع" }, { key: "status", label: "الحالة" }, { key: "uploader", label: "رفعه" }, { key: "created_at", label: "بتاريخ" }]}
          rows={rows.map((r) => ({ file_name: r.file_name, entity: IMPORT_ENTITY[r.entity_type] ?? r.entity_type, status: IMPORT_STATUS[r.status] ?? r.status, uploader: r.uploader, created_at: new Date(r.created_at).toLocaleDateString("ar") }))} />
      )}
    </div>
  );
}

// ============================================================ 6) المستخدمون والصلاحيات
// يقرأ عبر list_account_users() الموجودة أصلاً (SECURITY DEFINER تتحقق من users.manage بنفسها)،
// بدل قراءة app_users مباشرة، حتى لا يعتمد إظهار البيانات الحساسة على إخفاء الواجهة فقط.
const ROLE_LABEL: Record<string, string> = { solo_teacher: "معلّم مستقل", school_admin: "ناظر عام", assistant_admin: "مساعد إداري", subject_teacher: "أستاذ مادة", custom_role: "دور مخصّص" };
export function UsersReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [users, caps] = await Promise.all([
        supabase.rpc("list_account_users"),
        supabase.from("user_capabilities").select("app_user_id, granted"),
      ]);
      if (users.error) { setDenied(true); setLoading(false); return; }
      const capCount = new Map<string, number>();
      (caps.data ?? []).forEach((c: any) => { if (c.granted) capCount.set(c.app_user_id, (capCount.get(c.app_user_id) ?? 0) + 1); });
      setRows(((users.data ?? []) as any[]).map((u) => ({ ...u, caps: capCount.get(u.id) ?? 0 })));
      setLoading(false);
    })();
  }, [accountId]);
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>كل المستخدمين، أدوارهم، حالتهم، وعدد الصلاحيات العامة الممنوحة لكل منهم.</p>
      <Toolbar onExport={() => downloadCsv("users.csv", [["الاسم", "البريد", "الدور", "الحالة", "عدد الصلاحيات", "أُنشئ"], ...rows.map((r) => [r.full_name, r.email ?? "", ROLE_LABEL[r.role] ?? r.role, r.is_active ? "نشط" : "موقوف", r.caps, r.created_at])])} disabled={rows.length === 0} />
      {denied ? <p style={{ color: "var(--red)" }}>هذا التقرير يتطلب صلاحية إدارة المستخدمين.</p> : loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "full_name", label: "الاسم" }, { key: "email", label: "البريد" }, { key: "role", label: "الدور" }, { key: "status", label: "الحالة" }, { key: "caps", label: "عدد الصلاحيات" }]}
          rows={rows.map((r) => ({ full_name: r.full_name, email: r.email ?? "—", role: ROLE_LABEL[r.role] ?? r.role, status: r.is_active ? "نشط" : "موقوف", caps: r.caps }))} />
      )}
    </div>
  );
}

// ============================================================ 7) سجل التدقيق
const ACTION_LABEL: Record<string, string> = { insert: "إضافة", update: "تعديل", delete: "حذف", login: "دخول", grade_window_toggle: "فتح/قفل نافذة العلامات" };
export function AuditLogReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [logs, users] = await Promise.all([
        supabase.from("audit_logs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(500),
        supabase.from("app_users").select("id, full_name").eq("account_id", accountId),
      ]);
      const names = new Map((users.data ?? []).map((u: any) => [u.id, u.full_name]));
      const list = (logs.data ?? []).map((l: any) => ({ ...l, actor: names.get(l.user_id) ?? "النظام" }));
      setRows(list);
      setTables([...new Set(list.map((l: any) => l.table_name))].sort());
      setLoading(false);
    })();
  }, [accountId]);

  const shown = tableFilter ? rows.filter((r) => r.table_name === tableFilter) : rows;
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>آخر 500 عملية تعديل في الحساب: من فعلها، وماذا، ومتى. لا يُعدَّل ولا يُحذف.</p>
      <Toolbar onExport={() => downloadCsv("audit-log.csv", [["الوقت", "المستخدم", "الإجراء", "الجدول"], ...shown.map((r) => [new Date(r.created_at).toLocaleString("ar"), r.actor, ACTION_LABEL[r.action_type] ?? r.action_type, r.table_name])])} disabled={shown.length === 0}>
        <div><label style={lbl}>الجدول</label><select className="input" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}><option value="">الكل</option>{tables.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
      </Toolbar>
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : (
        <SimpleTable columns={[{ key: "time", label: "الوقت" }, { key: "actor", label: "المستخدم" }, { key: "action", label: "الإجراء" }, { key: "table", label: "الجدول" }]}
          rows={shown.slice(0, 200).map((r) => ({ time: new Date(r.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }), actor: r.actor, action: ACTION_LABEL[r.action_type] ?? r.action_type, table: r.table_name }))} />
      )}
      {shown.length > 200 && <p style={{ fontSize: "0.78rem", color: "var(--steel)" }}>تُعرض أول 200 نتيجة؛ صدّر CSV لرؤية الباقي (حتى 500).</p>}
    </div>
  );
}

// ============================================================ 8) ملخص مراسلات واتساب
export function WhatsAppSummaryReport({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<{ type: string; total: number; sent: number; failed: number; pending: number }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("notifications_log").select("message_type, status").eq("account_id", accountId);
      const acc = new Map<string, { total: number; sent: number; failed: number; pending: number }>();
      (data ?? []).forEach((r: any) => {
        const k = r.message_type ?? "—";
        const cur = acc.get(k) ?? { total: 0, sent: 0, failed: 0, pending: 0 };
        cur.total++; (cur as any)[r.status] = ((cur as any)[r.status] ?? 0) + 1;
        acc.set(k, cur);
      });
      setRows([...acc.entries()].map(([type, v]) => ({ type, ...v })));
      setLoading(false);
    })();
  }, [accountId]);
  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>ملخص عدد رسائل واتساب لكل نوع مراسلة وحالتها. للتفاصيل والمحادثات: «سجل محادثات واتساب».</p>
      <Toolbar onExport={() => downloadCsv("whatsapp-summary.csv", [["النوع", "المجموع", "أُرسلت", "فشلت", "بانتظار"], ...rows.map((r) => [r.type, r.total, r.sent, r.failed, r.pending])])} disabled={rows.length === 0} />
      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : rows.length === 0 ? <p style={{ color: "var(--steel)" }}>لا رسائل بعد.</p> : (
        <SimpleTable columns={[{ key: "type", label: "النوع" }, { key: "total", label: "المجموع" }, { key: "sent", label: "أُرسلت" }, { key: "failed", label: "فشلت" }, { key: "pending", label: "بانتظار" }]} rows={rows} />
      )}
    </div>
  );
}
