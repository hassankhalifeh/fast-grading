"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { normalizeAr } from "@/lib/csv";
import {
  ALL_SHEETS, SUBJECTS_SHEET, STAGES_SHEET, CLASSES_SHEET, STUDENTS_SHEET, TEACHERS_SHEET,
  ROLE_TEXT_TO_KEY, buildTemplateWorkbook, readWorkbookSheets, downloadBlob, type ImportRowResult,
} from "@/lib/bulkExcel";
import SimpleTable from "./SimpleTable";

const RESULT_COLUMNS = [
  { key: "sheet", label: "الورقة" }, { key: "row", label: "السطر" }, { key: "item", label: "العنصر" },
  { key: "status_text", label: "النتيجة" }, { key: "message", label: "التفاصيل" },
];
const STATUS_TEXT: Record<ImportRowResult["status"], string> = { ok: "✓ تمّ", skipped: "تخطٍّ", error: "✗ خطأ" };

// استيراد جماعي بملف Excel واحد متعدد الأوراق، بدل رفع كل جدول على حدة. الترتيب ثابت ومقصود:
// مواد/مراحل أولاً (لا تعتمد على شيء) ثم الصفوف (قد تعتمد على المراحل) ثم الطلاب (يعتمدون على الصفوف) ثم المعلمون أخيراً.
export default function BulkExcelImportPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function downloadTemplate() {
    setPreparing(true);
    try {
      const blob = await buildTemplateWorkbook();
      downloadBlob(blob, "نموذج-استيراد-جماعي.xlsx");
    } catch (e: any) {
      setError("تعذّر إنشاء النموذج: " + e.message);
    } finally {
      setPreparing(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResults([]);
    setBusy(true);
    const out: ImportRowResult[] = [];
    try {
      const sheets = await readWorkbookSheets(file);

      // مراجع محدَّثة أولاً بأول مع تقدّم الاستيراد، حتى تربط الصفوف اللاحقة بما أُنشئ للتو في الملف نفسه
      const [subRes, stRes, clsRes] = await Promise.all([
        supabase.from("subjects").select("id, name").eq("account_id", accountId),
        supabase.from("stages").select("id, stage_name").eq("account_id", accountId),
        supabase.from("class_sections").select("id, name").eq("account_id", accountId),
      ]);
      const subjectNames = new Set((subRes.data ?? []).map((s: any) => normalizeAr(s.name)));
      const stages = new Map<string, string>((stRes.data ?? []).map((s: any) => [normalizeAr(s.stage_name), s.id]));
      const classNames = new Map<string, string>((clsRes.data ?? []).map((c: any) => [normalizeAr(c.name), c.id]));

      // ١) المواد
      for (const r of sheets[SUBJECTS_SHEET.name] ?? []) {
        const name = (r["اسم المادة"] ?? "").trim();
        if (!name) continue;
        const key = normalizeAr(name);
        if (subjectNames.has(key)) { out.push({ sheet: SUBJECTS_SHEET.name, row: Number(r.__row), item: name, status: "skipped", message: "موجودة مسبقاً" }); continue; }
        const { error: err } = await supabase.from("subjects").insert({ account_id: accountId, name });
        if (err) out.push({ sheet: SUBJECTS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: err.message });
        else { subjectNames.add(key); out.push({ sheet: SUBJECTS_SHEET.name, row: Number(r.__row), item: name, status: "ok", message: "أُضيفت" }); }
      }

      // ٢) المراحل
      for (const r of sheets[STAGES_SHEET.name] ?? []) {
        const name = (r["اسم المرحلة"] ?? "").trim();
        if (!name) continue;
        const key = normalizeAr(name);
        if (stages.has(key)) { out.push({ sheet: STAGES_SHEET.name, row: Number(r.__row), item: name, status: "skipped", message: "موجودة مسبقاً" }); continue; }
        const orderRaw = (r["الترتيب (اختياري)"] ?? "").trim();
        const order_index = orderRaw ? Number(orderRaw) : null;
        const { data, error: err } = await supabase.from("stages").insert({ account_id: accountId, stage_name: name, order_index }).select("id").single();
        if (err || !data) out.push({ sheet: STAGES_SHEET.name, row: Number(r.__row), item: name, status: "error", message: err?.message ?? "تعذّرت الإضافة" });
        else { stages.set(key, data.id); out.push({ sheet: STAGES_SHEET.name, row: Number(r.__row), item: name, status: "ok", message: "أُضيفت" }); }
      }

      // ٣) الصفوف
      for (const r of sheets[CLASSES_SHEET.name] ?? []) {
        const name = (r["اسم الصف"] ?? "").trim();
        if (!name) continue;
        const key = normalizeAr(name);
        if (classNames.has(key)) { out.push({ sheet: CLASSES_SHEET.name, row: Number(r.__row), item: name, status: "skipped", message: "موجود مسبقاً بنفس الاسم" }); continue; }
        const stageName = (r["المرحلة (اختياري - اكتب الاسم كما في ورقة المراحل)"] ?? "").trim();
        const stage_id = stageName ? stages.get(normalizeAr(stageName)) ?? null : null;
        if (stageName && !stage_id) out.push({ sheet: CLASSES_SHEET.name, row: Number(r.__row), item: name, status: "error", message: `لم يُعثر على مرحلة باسم "${stageName}" — أُضيف الصف بلا مرحلة` });
        const { data, error: err } = await supabase.from("class_sections").insert({
          account_id: accountId, name,
          grade_level: (r["المستوى (اختياري)"] ?? "").trim() || null,
          section_label: (r["الشعبة (اختياري)"] ?? "").trim() || null,
          stage_id, created_by: appUser.id,
        }).select("id").single();
        if (err || !data) out.push({ sheet: CLASSES_SHEET.name, row: Number(r.__row), item: name, status: "error", message: err?.message ?? "تعذّرت الإضافة" });
        else { classNames.set(key, data.id); out.push({ sheet: CLASSES_SHEET.name, row: Number(r.__row), item: name, status: "ok", message: "أُضيف" }); }
      }

      // ٤) الطلاب (+ تسجيلهم في الشعبة)
      const enrolledInClass = new Map<string, Set<string>>(); // classId -> normalized names already enrolled (لتحذير التكرار فقط)
      for (const r of sheets[STUDENTS_SHEET.name] ?? []) {
        const name = (r["اسم الطالب"] ?? "").trim();
        if (!name) continue;
        const clsName = (r["الصف (اكتب الاسم كما في ورقة الصفوف)"] ?? "").trim();
        const classId = clsName ? classNames.get(normalizeAr(clsName)) : undefined;
        if (!clsName || !classId) { out.push({ sheet: STUDENTS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: `لم يُعثر على صف باسم "${clsName || "—"}" — لم يُضَف الطالب` }); continue; }
        const { data: stu, error: sErr } = await supabase.from("students").insert({
          account_id: accountId, full_name: name,
          parent_name: (r["اسم ولي الأمر (اختياري)"] ?? "").trim() || null,
          parent_phone: (r["هاتف ولي الأمر (اختياري)"] ?? "").trim() || null,
          parent_email: (r["بريد ولي الأمر (اختياري)"] ?? "").trim() || null,
        }).select("id").single();
        if (sErr || !stu) { out.push({ sheet: STUDENTS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: sErr?.message ?? "تعذّرت الإضافة" }); continue; }
        const { error: eErr } = await supabase.from("class_enrollments").insert({ class_section_id: classId, student_id: stu.id, status: "active" });
        if (eErr) { out.push({ sheet: STUDENTS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: "أُضيف الطالب لكن تعذّر تسجيله بالشعبة: " + eErr.message }); continue; }
        const seen = enrolledInClass.get(classId) ?? new Set<string>();
        const dupWarning = seen.has(normalizeAr(name)) ? " (تنبيه: اسم مطابق لطالب أُضيف سابقاً بنفس الملف في هذا الصف — راجع للتأكد أنه ليس تكراراً)" : "";
        seen.add(normalizeAr(name)); enrolledInClass.set(classId, seen);
        out.push({ sheet: STUDENTS_SHEET.name, row: Number(r.__row), item: name, status: "ok", message: "أُضيف وسُجِّل بالصف" + dupWarning });
      }

      // ٥) المعلمون (دعوات) — نفس مسار دعوة شاشة المستخدمين
      const allowedRoles = appUser.role === "solo_teacher" ? ["school_admin", "assistant_admin", "subject_teacher"] : appUser.role === "school_admin" ? ["assistant_admin", "subject_teacher"] : [];
      for (const r of sheets[TEACHERS_SHEET.name] ?? []) {
        const name = (r["الاسم"] ?? "").trim();
        const email = (r["البريد الإلكتروني"] ?? "").trim();
        if (!name && !email) continue;
        if (!name || !email) { out.push({ sheet: TEACHERS_SHEET.name, row: Number(r.__row), item: name || email, status: "error", message: "الاسم والبريد كلاهما إلزامي" }); continue; }
        const roleText = (r["الدور (معلم مادة / مساعد ناظر / ناظر عام)"] ?? "").trim();
        const role = roleText ? ROLE_TEXT_TO_KEY[roleText] : "subject_teacher";
        if (!role) { out.push({ sheet: TEACHERS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: `دور غير معروف: "${roleText}"` }); continue; }
        if (!allowedRoles.includes(role)) { out.push({ sheet: TEACHERS_SHEET.name, row: Number(r.__row), item: name, status: "error", message: "دورك الحالي لا يسمح بدعوة هذا الدور" }); continue; }
        const { data, error: err } = await supabase.functions.invoke("fastgrading-invite-user", {
          body: { email, full_name: name, phone: (r["الهاتف (اختياري)"] ?? "").trim() || null, role, redirect_to: window.location.origin },
        });
        let msg = data?.message ?? data?.error ?? "";
        if (err) { try { msg = (await (err as any).context?.json?.())?.error ?? err.message; } catch { msg = err.message; } }
        out.push({ sheet: TEACHERS_SHEET.name, row: Number(r.__row), item: name, status: err || data?.error ? "error" : "ok", message: msg || "أُرسلت الدعوة" });
      }

      setResults(out);
    } catch (e: any) {
      setError("تعذّرت قراءة الملف: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const shaped = results.map((r) => ({ ...r, status_text: STATUS_TEXT[r.status] }));
  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        ملف Excel واحد بعدة أوراق (مواد، مراحل، صفوف، طلاب، دعوات معلمين) بدل رفع كل جدول على حدة. نزّل النموذج، عبّئه بالترتيب المذكور في ورقة «تعليمات»، ثم ارفعه هنا.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn btn-secondary" disabled={preparing} onClick={downloadTemplate}>{preparing ? "جارٍ التجهيز..." : "تنزيل نموذج Excel"}</button>
        <label className="btn btn-gold" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "جارٍ الاستيراد..." : "رفع الملف المعبّأ"}
          <input type="file" accept=".xlsx" onChange={handleFile} disabled={busy} style={{ display: "none" }} />
        </label>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {results.length > 0 && (
        <>
          <p style={{ fontSize: "0.85rem", marginBottom: 8 }}>
            النتيجة: <b style={{ color: "var(--green)" }}>{okCount} تم بنجاح</b>{errCount > 0 && <> — <b style={{ color: "var(--red)" }}>{errCount} خطأ</b></>}
          </p>
          <SimpleTable columns={RESULT_COLUMNS} rows={shaped} />
        </>
      )}
    </div>
  );
}
