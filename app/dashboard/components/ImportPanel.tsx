"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { parseCsv, normalizeAr, guessColumn } from "@/lib/csv";
import { useTableKit } from "@/lib/tablekit";

interface Named { id: string; name: string }
type Kind = "student" | "class" | "teacher";

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const STATUS_LABEL: Record<string, string> = { pending_review: "بانتظار المراجعة", committed: "معتمدة", cancelled: "ملغاة" };
const KIND_LABEL: Record<string, string> = { student: "طلاب", class: "صفوف", teacher: "معلمون" };

// نص الحالة كما يظهر في جداول المراجعة (للبحث والفلترة)
const studentStatusText = (s: any) => (s.match_status === "new" ? "جديد" : s.match_status === "identical" ? "مطابق" : `متصادم (${Math.round((s.similarity_score ?? 0) * 100)}%)`);
const STUDENT_STAGING_COLUMNS = [{ key: "raw_full_name", label: "الاسم بالملف" }, { key: "status", label: "الحالة" }, { key: "matched", label: "الموجود بالنظام" }];
const studentStagingText = (s: any, k: string) => (k === "status" ? studentStatusText(s) : k === "matched" ? s.matched?.full_name ?? "—" : String(s[k] ?? "—"));
const CLASS_STAGING_COLUMNS = [{ key: "raw_name", label: "الصف" }, { key: "status", label: "الحالة" }];
const classStagingText = (s: any, k: string) => (k === "status" ? (s.match_status === "new" ? "جديد — سيُضاف" : "موجود مسبقاً — يُتجاوز") : String(s[k] ?? "—"));
const INVITE_COLUMNS = [{ key: "email", label: "البريد" }, { key: "msg", label: "النتيجة" }];
const inviteText = (r: any, k: string) => (k === "msg" ? `${r.ok ? "✓ " : "✗ "}${r.msg}` : String(r[k] ?? "—"));
const HISTORY_COLUMNS = [{ key: "entity_type", label: "النوع" }, { key: "status", label: "الحالة" }, { key: "created_at", label: "التاريخ" }];
const historyText = (h: any, k: string) => (k === "entity_type" ? KIND_LABEL[h.entity_type] ?? h.entity_type : k === "status" ? STATUS_LABEL[h.status] ?? h.status : new Date(h.created_at).toLocaleString("ar"));

function useNotes() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fail = (m: string) => { setMessage(null); setError(m.includes("row-level security") ? "ليس لديك صلاحية الاستيراد (records.import_manage)" : m); };
  const ok = (m: string) => { setError(null); setMessage(m); };
  const banner = (
    <>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", margin: "0 0 10px", whiteSpace: "pre-line" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", margin: "0 0 10px" }}>{message}</p>}
    </>
  );
  return { fail, ok, banner };
}

function FileLoader({ onLoaded }: { onLoaded: (rows: string[][]) => void }) {
  const [text, setText] = useState("");
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => onLoaded(parseCsv(t)));
  }
  return (
    <div className="card" style={{ padding: "1.1rem", marginBottom: 14 }}>
      <label style={lbl}>ملف CSV (من Excel: احفظ باسم ← CSV UTF-8) — السطر الأول عناوين الأعمدة</label>
      <input type="file" accept=".csv,.txt,.tsv" onChange={handleFile} style={{ marginBottom: 10 }} />
      <label style={lbl}>أو الصق البيانات هنا</label>
      <textarea className="input" style={{ height: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"الاسم,هاتف ولي الأمر\nمحمد أحمد,0123"} />
      <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => onLoaded(parseCsv(text))} disabled={!text.trim()}>قراءة البيانات</button>
    </div>
  );
}

function ColumnSelect({ label, headers, value, onChange, required }: { label: string; headers: string[]; value: number; onChange: (n: number) => void; required?: boolean }) {
  return (
    <div><label style={lbl}>{label}{required && <span style={{ color: "var(--red)" }}> *</span>}</label>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={-1}>— لا يوجد —</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}
      </select></div>
  );
}

// ---------------------------------------------------------------- الطلاب
interface StagingStudent {
  id: string; raw_full_name: string; raw_class_section_id: string | null; raw_extra: Record<string, string> | null;
  match_status: "new" | "identical" | "conflict"; similarity_score: number | null;
  resolved_action: string; resolved_final_name: string | null; matched: { full_name: string } | null;
}

function StudentImport({ accountId, appUser, onBatchDone }: { accountId: string; appUser: AppUser; onBatchDone: () => void }) {
  const { fail, ok, banner } = useNotes();
  const [classes, setClasses] = useState<Named[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState({ name: -1, parent: -1, phone: -1, email: -1, cls: -1 });
  const [defaultClass, setDefaultClass] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [staging, setStaging] = useState<StagingStudent[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name").then(({ data }) => setClasses((data ?? []) as Named[]));
  }, [accountId]);

  function loaded(r: string[][]) {
    if (r.length < 2) return fail("الملف فارغ أو فيه سطر العناوين فقط");
    setRows(r);
    const h = r[0];
    setMap({
      name: guessColumn(h, ["اسم الطالب", "الاسم", "name"]),
      parent: guessColumn(h, ["ولي", "parent"]),
      phone: guessColumn(h, ["هاتف", "جوال", "phone", "mobile"]),
      email: guessColumn(h, ["بريد", "email", "mail"]),
      cls: guessColumn(h, ["الصف", "الشعبه", "class"]),
    });
    ok(`تمت قراءة ${r.length - 1} سطر`);
  }

  async function createBatch() {
    if (map.name < 0) return fail("اختر عمود اسم الطالب");
    const errors: string[] = [];
    const items: { name: string; classId: string; extra: Record<string, string> }[] = [];
    rows.slice(1).forEach((r, i) => {
      const name = (r[map.name] ?? "").trim();
      if (!name) return;
      let classId = defaultClass;
      if (map.cls >= 0 && (r[map.cls] ?? "").trim()) {
        const m = classes.find((c) => normalizeAr(c.name) === normalizeAr(r[map.cls]));
        if (!m) { errors.push(`السطر ${i + 2}: الصف "${r[map.cls]}" غير موجود`); return; }
        classId = m.id;
      }
      if (!classId) { errors.push(`السطر ${i + 2}: لا يوجد صف (اختر صفاً افتراضياً أو عمود الصف)`); return; }
      const extra: Record<string, string> = {};
      if (map.parent >= 0 && r[map.parent]) extra.parent_name = r[map.parent];
      if (map.phone >= 0 && r[map.phone]) extra.parent_phone = r[map.phone];
      if (map.email >= 0 && r[map.email]) extra.parent_email = r[map.email];
      items.push({ name, classId, extra });
    });
    if (errors.length) return fail(errors.slice(0, 8).join("\n") + (errors.length > 8 ? `\n... و${errors.length - 8} أخرى` : ""));
    if (items.length === 0) return fail("لا توجد أسطر صالحة");

    setBusy(true);
    const { data: batch, error: bErr } = await supabase.from("import_batches")
      .insert({ account_id: accountId, entity_type: "student", file_name: "طلاب", uploaded_by: appUser.id }).select().single();
    if (bErr || !batch) { setBusy(false); return fail(bErr?.message ?? "تعذر إنشاء الدفعة"); }
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200).map((it) => ({ batch_id: batch.id, raw_full_name: it.name, raw_class_section_id: it.classId, raw_extra: it.extra }));
      const { error: sErr } = await supabase.from("import_staging_students").insert(chunk);
      if (sErr) { setBusy(false); return fail(sErr.message); }
    }
    const { error: aErr } = await supabase.rpc("analyze_student_import_batch", { p_batch_id: batch.id });
    setBusy(false);
    if (aErr) return fail(aErr.message);
    setBatchId(batch.id);
    await loadStaging(batch.id);
    onBatchDone();
  }

  async function loadStaging(id: string) {
    const { data } = await supabase.from("import_staging_students").select("*, matched:matched_student_id(full_name)").eq("batch_id", id).order("match_status");
    setStaging((data ?? []) as any);
  }

  async function resolve(row: StagingStudent, action: string, finalName?: string) {
    const { error: err } = await supabase.from("import_staging_students").update({
      resolved_action: action, resolved_final_name: finalName ?? row.resolved_final_name, resolved_by: appUser.id, resolved_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (err) return fail(err.message);
    if (batchId) loadStaging(batchId);
  }

  async function commit() {
    if (!batchId) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc("commit_student_import_batch", { p_batch_id: batchId, p_actor_id: appUser.id });
    setBusy(false);
    if (err) return fail(err.message);
    ok(String(data));
    setBatchId(null); setStaging([]); setRows([]); onBatchDone();
  }

  async function cancel() {
    if (!batchId) return;
    await supabase.from("import_batches").update({ status: "cancelled" }).eq("id", batchId);
    setBatchId(null); setStaging([]); ok("أُلغيت الدفعة"); onBatchDone();
  }

  const pending = staging.filter((s) => s.match_status === "conflict" && s.resolved_action === "pending").length;
  const count = (st: string) => staging.filter((s) => s.match_status === st).length;
  const tk = useTableKit(staging, STUDENT_STAGING_COLUMNS, { getText: studentStagingText });

  if (batchId) {
    return (
      <div>
        {banner}
        <p style={{ fontSize: "0.85rem", marginBottom: 10 }}>
          جديد: <b>{count("new")}</b> — مطابق (لا تغيير): <b>{count("identical")}</b> — متصادم يحتاج قرارك: <b style={{ color: pending ? "var(--red)" : "var(--green)" }}>{pending}</b>
        </p>
        {tk.toolbar}
        <div className="card" style={{ overflowX: "auto", marginBottom: 12 }}>
          <table className="data-table">
            <thead><tr><th>الاسم بالملف</th><th>الحالة</th><th>الموجود بالنظام</th><th>القرار</th></tr></thead>
            <tbody>
              {tk.rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.raw_full_name}</td>
                  <td style={{ fontWeight: 700, color: s.match_status === "conflict" ? "var(--red)" : s.match_status === "new" ? "var(--green)" : "var(--steel)" }}>
                    {studentStatusText(s)}
                  </td>
                  <td>{s.matched?.full_name ?? "—"}</td>
                  <td>
                    {s.match_status === "conflict" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <select className="input" style={{ maxWidth: 200, borderColor: s.resolved_action === "pending" ? "var(--red)" : undefined }}
                          value={s.resolved_action} onChange={(e) => resolve(s, e.target.value, e.target.value === "manual_edit" ? (s.resolved_final_name ?? s.raw_full_name) : undefined)}>
                          <option value="pending">— قرّر —</option>
                          <option value="accept_new">هو نفس الطالب: اعتماد الاسم الجديد</option>
                          <option value="keep_old">هو نفس الطالب: إبقاء القديم</option>
                          <option value="manual_edit">هو نفس الطالب: تعديل الاسم يدوياً</option>
                          <option value="ignore">تجاهل السطر</option>
                        </select>
                        {s.resolved_action === "manual_edit" && (
                          <input className="input" style={{ maxWidth: 200 }} defaultValue={s.resolved_final_name ?? s.raw_full_name}
                            onBlur={(e) => resolve(s, "manual_edit", e.target.value)} />
                        )}
                      </div>
                    ) : (
                      <select className="input" style={{ maxWidth: 160 }} value={s.resolved_action === "ignore" ? "ignore" : "pending"} onChange={(e) => resolve(s, e.target.value)}>
                        <option value="pending">{s.match_status === "new" ? "إضافة" : "لا تغيير"}</option>
                        <option value="ignore">تجاهل</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-gold" disabled={busy || pending > 0} onClick={commit}>{pending > 0 ? `احسم ${pending} تصادم أولاً` : "اعتماد الدفعة"}</button>
          <button className="btn btn-secondary" onClick={cancel}>إلغاء الدفعة</button>
        </div>
      </div>
    );
  }

  const headers = rows[0] ?? [];
  return (
    <div>
      {banner}
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 10 }}>
        المطابقة تتم ضمن نفس الصف وتتسامح مع اختلاف الهمزة والتاء المربوطة والتشكيل. أي اسم مشابه وليس مطابقاً يُعرض عليك لتقرر قبل الاعتماد.
      </p>
      <FileLoader onLoaded={loaded} />
      {rows.length > 1 && (
        <div className="card" style={{ padding: "1.1rem" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <ColumnSelect label="اسم الطالب" headers={headers} value={map.name} onChange={(n) => setMap({ ...map, name: n })} required />
            <ColumnSelect label="اسم ولي الأمر" headers={headers} value={map.parent} onChange={(n) => setMap({ ...map, parent: n })} />
            <ColumnSelect label="هاتف ولي الأمر" headers={headers} value={map.phone} onChange={(n) => setMap({ ...map, phone: n })} />
            <ColumnSelect label="بريد ولي الأمر" headers={headers} value={map.email} onChange={(n) => setMap({ ...map, email: n })} />
            <ColumnSelect label="عمود الصف (اختياري)" headers={headers} value={map.cls} onChange={(n) => setMap({ ...map, cls: n })} />
            <div><label style={lbl}>صف افتراضي لكل السطور</label>
              <select className="input" value={defaultClass} onChange={(e) => setDefaultClass(e.target.value)}>
                <option value="">— لا يوجد —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          <button className="btn btn-gold" disabled={busy} onClick={createBatch}>{busy ? "جارٍ التحليل..." : `تحليل ${rows.length - 1} سطر ومراجعته`}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- الصفوف
function ClassImport({ accountId, appUser, onBatchDone }: { accountId: string; appUser: AppUser; onBatchDone: () => void }) {
  const { fail, ok, banner } = useNotes();
  const [stages, setStages] = useState<Named[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState({ name: -1, grade: -1, section: -1, stage: -1 });
  const [batchId, setBatchId] = useState<string | null>(null);
  const [staging, setStaging] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const tk = useTableKit(staging, CLASS_STAGING_COLUMNS, { getText: classStagingText });

  useEffect(() => {
    supabase.from("stages").select("id, stage_name").eq("account_id", accountId).then(({ data }) =>
      setStages((data ?? []).map((s: any) => ({ id: s.id, name: s.stage_name }))));
  }, [accountId]);

  function loaded(r: string[][]) {
    if (r.length < 2) return fail("الملف فارغ أو فيه سطر العناوين فقط");
    setRows(r);
    const h = r[0];
    setMap({ name: guessColumn(h, ["اسم الصف", "الاسم", "الصف", "name"]), grade: guessColumn(h, ["المستوى", "grade"]), section: guessColumn(h, ["الشعبه", "section"]), stage: guessColumn(h, ["المرحله", "stage"]) });
    ok(`تمت قراءة ${r.length - 1} سطر`);
  }

  async function createBatch() {
    if (map.name < 0) return fail("اختر عمود اسم الصف");
    const errors: string[] = [];
    const items: any[] = [];
    rows.slice(1).forEach((r, i) => {
      const name = (r[map.name] ?? "").trim();
      if (!name) return;
      let stageId: string | null = null;
      if (map.stage >= 0 && (r[map.stage] ?? "").trim()) {
        const m = stages.find((s) => normalizeAr(s.name) === normalizeAr(r[map.stage]));
        if (!m) { errors.push(`السطر ${i + 2}: المرحلة "${r[map.stage]}" غير موجودة`); return; }
        stageId = m.id;
      }
      items.push({ raw_name: name, raw_grade_level: map.grade >= 0 ? r[map.grade] ?? "" : "", raw_section_label: map.section >= 0 ? r[map.section] ?? "" : "", raw_stage_id: stageId });
    });
    if (errors.length) return fail(errors.slice(0, 8).join("\n"));
    if (items.length === 0) return fail("لا توجد أسطر صالحة");
    setBusy(true);
    const { data: batch, error: bErr } = await supabase.from("import_batches").insert({ account_id: accountId, entity_type: "class", file_name: "صفوف", uploaded_by: appUser.id }).select().single();
    if (bErr || !batch) { setBusy(false); return fail(bErr?.message ?? "تعذر إنشاء الدفعة"); }
    const { error: sErr } = await supabase.from("import_staging_classes").insert(items.map((it) => ({ ...it, batch_id: batch.id })));
    if (sErr) { setBusy(false); return fail(sErr.message); }
    const { error: aErr } = await supabase.rpc("analyze_class_import_batch", { p_batch_id: batch.id });
    setBusy(false);
    if (aErr) return fail(aErr.message);
    setBatchId(batch.id);
    const { data } = await supabase.from("import_staging_classes").select("*").eq("batch_id", batch.id);
    setStaging(data ?? []);
    onBatchDone();
  }

  async function commit() {
    if (!batchId) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc("commit_class_import_batch", { p_batch_id: batchId, p_actor_id: appUser.id });
    setBusy(false);
    if (err) return fail(err.message.includes("Limit reached") ? "وصلت لحد الصفوف في خطتك" : err.message);
    ok(String(data));
    setBatchId(null); setStaging([]); setRows([]); onBatchDone();
  }

  async function cancel() {
    if (batchId) await supabase.from("import_batches").update({ status: "cancelled" }).eq("id", batchId);
    setBatchId(null); setStaging([]); onBatchDone();
  }

  if (batchId) {
    return (
      <div>
        {banner}
        {tk.toolbar}
        <div className="card" style={{ overflowX: "auto", marginBottom: 12 }}>
          <table className="data-table">
            <thead><tr><th>الصف</th><th>الحالة</th></tr></thead>
            <tbody>{tk.rows.map((s) => (
              <tr key={s.id}><td>{s.raw_name}</td>
                <td style={{ fontWeight: 700, color: s.match_status === "new" ? "var(--green)" : "var(--steel)" }}>{s.match_status === "new" ? "جديد — سيُضاف" : "موجود مسبقاً — يُتجاوز"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-gold" disabled={busy} onClick={commit}>اعتماد الدفعة</button>
          <button className="btn btn-secondary" onClick={cancel}>إلغاء الدفعة</button>
        </div>
      </div>
    );
  }
  const headers = rows[0] ?? [];
  return (
    <div>
      {banner}
      <FileLoader onLoaded={loaded} />
      {rows.length > 1 && (
        <div className="card" style={{ padding: "1.1rem" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <ColumnSelect label="اسم الصف" headers={headers} value={map.name} onChange={(n) => setMap({ ...map, name: n })} required />
            <ColumnSelect label="المستوى الدراسي" headers={headers} value={map.grade} onChange={(n) => setMap({ ...map, grade: n })} />
            <ColumnSelect label="الشعبة" headers={headers} value={map.section} onChange={(n) => setMap({ ...map, section: n })} />
            <ColumnSelect label="المرحلة" headers={headers} value={map.stage} onChange={(n) => setMap({ ...map, stage: n })} />
          </div>
          <button className="btn btn-gold" disabled={busy} onClick={createBatch}>{busy ? "جارٍ التحليل..." : `تحليل ${rows.length - 1} سطر`}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- المعلمون (دعوات جماعية)
function TeacherInvites({ appUser }: { appUser: AppUser }) {
  const { fail, ok, banner } = useNotes();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState({ name: -1, email: -1, phone: -1 });
  const [role, setRole] = useState("subject_teacher");
  const [results, setResults] = useState<{ email: string; ok: boolean; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const tk = useTableKit(results, INVITE_COLUMNS, { getText: inviteText });

  function loaded(r: string[][]) {
    if (r.length < 2) return fail("الملف فارغ أو فيه سطر العناوين فقط");
    setRows(r);
    const h = r[0];
    setMap({ name: guessColumn(h, ["الاسم", "name"]), email: guessColumn(h, ["بريد", "email", "mail"]), phone: guessColumn(h, ["هاتف", "جوال", "phone"]) });
    setResults([]);
    ok(`تمت قراءة ${r.length - 1} سطر`);
  }

  async function send() {
    if (map.name < 0 || map.email < 0) return fail("اختر عمودي الاسم والبريد");
    setBusy(true);
    const out: typeof results = [];
    for (const r of rows.slice(1)) {
      const email = (r[map.email] ?? "").trim();
      const full_name = (r[map.name] ?? "").trim();
      if (!email || !full_name) continue;
      const { data, error: err } = await supabase.functions.invoke("invite-user", {
        body: { email, full_name, phone: map.phone >= 0 ? r[map.phone] || null : null, role, redirect_to: window.location.origin },
      });
      let msg = data?.message ?? data?.error ?? "";
      if (err) { try { msg = (await (err as any).context?.json?.())?.error ?? err.message; } catch { msg = err.message; } }
      out.push({ email, ok: !err && !data?.error, msg });
      setResults([...out]);
    }
    setBusy(false);
    ok(`اكتملت الدعوات: ${out.filter((x) => x.ok).length} ناجحة من ${out.length}`);
  }

  const headers = rows[0] ?? [];
  const allowed = appUser.role === "solo_teacher" ? ["school_admin", "assistant_admin", "subject_teacher", "custom_role"] : appUser.role === "school_admin" ? ["assistant_admin", "subject_teacher", "custom_role"] : [];
  return (
    <div>
      {banner}
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 10 }}>
        المعلمون يحتاجون حساب دخول، فالاستيراد هنا يرسل دعوة لكل بريد (نفس شاشة "المستخدمون"). من سبق تسجيله يُذكر في النتيجة.
      </p>
      <FileLoader onLoaded={loaded} />
      {rows.length > 1 && (
        <div className="card" style={{ padding: "1.1rem", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <ColumnSelect label="الاسم" headers={headers} value={map.name} onChange={(n) => setMap({ ...map, name: n })} required />
            <ColumnSelect label="البريد الإلكتروني" headers={headers} value={map.email} onChange={(n) => setMap({ ...map, email: n })} required />
            <ColumnSelect label="الهاتف" headers={headers} value={map.phone} onChange={(n) => setMap({ ...map, phone: n })} />
            <div><label style={lbl}>الدور</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {allowed.map((r) => <option key={r} value={r}>{({ school_admin: "الناظر العام", assistant_admin: "مساعد ناظر", subject_teacher: "معلم مادة", custom_role: "دور مخصص" } as any)[r]}</option>)}
              </select></div>
          </div>
          <button className="btn btn-gold" disabled={busy} onClick={send}>{busy ? "جارٍ الإرسال..." : `إرسال ${rows.length - 1} دعوة`}</button>
        </div>
      )}
      {results.length > 0 && tk.toolbar}
      {results.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="data-table"><thead><tr><th>البريد</th><th>النتيجة</th></tr></thead>
            <tbody>{tk.rows.map((r, i) => <tr key={i}><td>{r.email}</td><td style={{ color: r.ok ? "var(--green)" : "var(--red)" }}>{r.ok ? "✓ " : "✗ "}{r.msg}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- الحاوية
export default function ImportPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [kind, setKind] = useState<Kind>("student");
  const [history, setHistory] = useState<any[]>([]);
  const tk = useTableKit(history, HISTORY_COLUMNS, { getText: historyText });

  async function loadHistory() {
    const { data } = await supabase.from("import_batches").select("id, entity_type, status, created_at, committed_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(10);
    setHistory(data ?? []);
  }
  useEffect(() => { loadHistory(); }, [accountId]);

  const tab = (id: Kind, label: string) => (
    <button onClick={() => setKind(id)} className="btn"
      style={{ background: kind === id ? "var(--indigo)" : "white", color: kind === id ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>{label}</button>
  );

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>{tab("student", "الطلاب")}{tab("class", "الصفوف")}{tab("teacher", "المعلمون (دعوات)")}</div>
      {kind === "student" && <StudentImport accountId={accountId} appUser={appUser} onBatchDone={loadHistory} />}
      {kind === "class" && <ClassImport accountId={accountId} appUser={appUser} onBatchDone={loadHistory} />}
      {kind === "teacher" && <TeacherInvites appUser={appUser} />}

      {history.length > 0 && kind !== "teacher" && (
        <div style={{ marginTop: 22 }}>
          <strong style={{ color: "var(--indigo)" }}>آخر الدفعات</strong>
          {tk.toolbar}
          <div className="card" style={{ marginTop: 8, overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>النوع</th><th>الحالة</th><th>التاريخ</th></tr></thead>
              <tbody>{tk.rows.map((h) => (
                <tr key={h.id}><td>{KIND_LABEL[h.entity_type] ?? h.entity_type}</td><td>{STATUS_LABEL[h.status] ?? h.status}</td>
                  <td>{new Date(h.created_at).toLocaleString("ar")}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
