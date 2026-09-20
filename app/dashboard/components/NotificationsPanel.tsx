"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { MessageCircle, Save, Trash2 } from "lucide-react";

interface ExamRow { id: string; exam_name: string; exam_date: string | null; max_score: number; class_section_id: string; subject_id: string; class_sections: { name: string } | null; subjects: { name: string } | null }
interface Template { id: string; name: string; body_template: string }
interface Row {
  studentId: string; name: string; parentName: string | null; rawPhone: string | null;
  phone: string | null; score: number | null; sentBefore: boolean;
}
interface QueueItem { logId: string; studentId: string; name: string; phone: string; link: string; state: "pending" | "opened" | "failed" }

const DEFAULT_BODY = "السلام عليكم {الولي}،\nنعلمكم أن علامة الطالب/ة {الطالب} في مادة {المادة} ({الامتحان}) هي {العلامة} من {الحد}.\nإدارة {المدرسة}";
const TOKENS = ["الطالب", "الولي", "المادة", "الامتحان", "العلامة", "الحد", "الصف", "المدرسة"];
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

// رقم دولي بلا + أو أصفار بادئة: يزيل الرموز، 00 → دولي، والصفر المحلي يُستبدل برمز الدولة
export function normalizePhone(raw: string | null, cc: string): string | null {
  if (!raw) return null;
  let d = raw.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = cc + d.slice(1);
  else if (cc && d.length <= 8) d = cc + d;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

function render(body: string, v: Record<string, string>) {
  return body.replace(/\{([^{}]+)\}/g, (m, k) => (k in v ? v[k] : m));
}

function friendly(m: string) {
  if (m.includes("row-level security")) return "ليس لديك صلاحية إرسال الإشعارات";
  return m;
}

// معالج إشعارات أولياء الأمور: اختيار امتحان → قالب رسالة → مراجعة (الكل محدد افتراضياً، أزل من لا تريد) → إرسال واتساب.
export default function NotificationsPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [examId, setExamId] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [tplName, setTplName] = useState("");
  const [cc, setCc] = useState("961");
  const [school, setSchool] = useState("المدرسة");
  const [rows, setRows] = useState<Row[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const exam = exams.find((e) => e.id === examId) ?? null;
  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };

  async function loadBase() {
    const [ex, tp, ac] = await Promise.all([
      supabase.from("exams").select("id, exam_name, exam_date, max_score, class_section_id, subject_id, class_sections(name), subjects(name)")
        .eq("account_id", accountId).order("exam_date", { ascending: false, nullsFirst: false }).limit(200),
      supabase.from("notification_templates").select("id, name, body_template").eq("account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
    ]);
    setExams((ex.data ?? []) as unknown as ExamRow[]);
    setTemplates((tp.data ?? []) as Template[]);
    if (ac.data?.display_name) setSchool(ac.data.display_name);
  }
  useEffect(() => { loadBase(); }, [accountId]);

  async function loadRoster(e: ExamRow, code: string) {
    setLoading(true); setQueue(null); setOverride({}); setEditing(null);
    const [enr, gr, sent] = await Promise.all([
      supabase.from("class_enrollments").select("student_id, students(full_name, parent_name, parent_phone)").eq("class_section_id", e.class_section_id),
      supabase.from("grades").select("student_id, score").eq("exam_id", e.id),
      supabase.from("notifications_log").select("student_id").eq("exam_id", e.id).eq("status", "sent"),
    ]);
    setLoading(false);
    if (enr.error) return fail(enr.error.message);
    const totals = new Map<string, number>();
    (gr.data ?? []).forEach((g: any) => { if (g.score !== null) totals.set(g.student_id, (totals.get(g.student_id) ?? 0) + Number(g.score)); });
    const sentSet = new Set((sent.data ?? []).map((x: any) => x.student_id));
    const list: Row[] = (enr.data ?? []).map((r: any) => ({
      studentId: r.student_id, name: r.students?.full_name ?? "—", parentName: r.students?.parent_name ?? null,
      rawPhone: r.students?.parent_phone ?? null, phone: normalizePhone(r.students?.parent_phone ?? null, code),
      score: totals.has(r.student_id) ? totals.get(r.student_id)! : null, sentBefore: sentSet.has(r.student_id),
    })).sort((a: Row, b: Row) => a.name.localeCompare(b.name, "ar"));
    setRows(list);
    // الكل محدد افتراضياً: من لديه رقم صالح وعلامة ولم يُرسل له سابقاً لهذا الامتحان
    setChecked(new Set(list.filter((r) => r.phone && r.score !== null && !r.sentBefore).map((r) => r.studentId)));
  }
  useEffect(() => { if (exam) loadRoster(exam, cc); else { setRows([]); setChecked(new Set()); } }, [examId, cc]);

  const messageFor = (r: Row) => override[r.studentId] ?? render(body, {
    الطالب: r.name, الولي: r.parentName ?? "ولي الأمر", المادة: exam?.subjects?.name ?? "", الامتحان: exam?.exam_name ?? "",
    العلامة: r.score === null ? "—" : fmt(r.score), الحد: exam ? fmt(Number(exam.max_score)) : "", الصف: exam?.class_sections?.name ?? "", المدرسة: school,
  });

  const sendable = (r: Row) => !!r.phone && r.score !== null;
  const selected = useMemo(() => rows.filter((r) => checked.has(r.studentId) && sendable(r)), [rows, checked]);

  function toggle(id: string) { setChecked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selectAll(on: boolean) { setChecked(on ? new Set(rows.filter(sendable).map((r) => r.studentId)) : new Set()); }

  async function saveTemplate() {
    if (!tplName.trim()) return fail("اكتب اسماً للقالب");
    const { error: e } = await supabase.from("notification_templates").insert({ account_id: accountId, name: tplName.trim(), body_template: body, created_by: appUser.id });
    if (e) return fail(e.message);
    setTplName(""); ok("حُفظ القالب"); loadBase();
  }
  async function deleteTemplate(id: string) {
    const { error: e } = await supabase.from("notification_templates").delete().eq("id", id);
    if (e) return fail(e.message);
    loadBase();
  }

  async function prepareSend() {
    if (!exam || selected.length === 0) return;
    setError(null);
    const batch = crypto.randomUUID();
    const payload = selected.map((r) => ({
      account_id: accountId, student_id: r.studentId, exam_id: exam.id, channel: "whatsapp", rendered_message: messageFor(r),
      status: "pending", to_phone: r.phone, batch_id: batch, sent_by: appUser.id,
    }));
    const { data, error: e } = await supabase.from("notifications_log").insert(payload).select("id, student_id, to_phone, rendered_message");
    if (e) return fail(e.message);
    const byStudent = new Map(selected.map((r) => [r.studentId, r]));
    setQueue((data ?? []).map((d: any) => ({
      logId: d.id, studentId: d.student_id, name: byStudent.get(d.student_id)?.name ?? "", phone: d.to_phone,
      link: `https://wa.me/${d.to_phone}?text=${encodeURIComponent(d.rendered_message)}`, state: "pending" as const,
    })));
    ok(`جُهّزت ${data?.length ?? 0} رسالة — افتح واتساب لكل واحدة بالضغط على الزر`);
  }

  async function openOne(item: QueueItem) {
    window.open(item.link, "_blank", "noopener");
    const { error: e } = await supabase.from("notifications_log").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", item.logId);
    if (e) return fail(e.message);
    setQueue((q) => q && q.map((x) => (x.logId === item.logId ? { ...x, state: "opened" } : x)));
  }
  async function markFailed(item: QueueItem) {
    const { error: e } = await supabase.from("notifications_log").update({ status: "failed" }).eq("id", item.logId);
    if (e) return fail(e.message);
    setQueue((q) => q && q.map((x) => (x.logId === item.logId ? { ...x, state: "failed" } : x)));
  }
  const nextPending = queue?.find((x) => x.state === "pending") ?? null;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>إشعارات أولياء الأمور</h2>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={lbl}>1) الامتحان</label>
            <select className="input" style={{ minWidth: 280 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">— اختر —</option>
              {exams.map((x) => <option key={x.id} value={x.id}>{x.class_sections?.name} · {x.subjects?.name} · {x.exam_name}{x.exam_date ? ` (${x.exam_date})` : ""}</option>)}
            </select></div>
          <div><label style={lbl}>رمز الدولة للأرقام المحلية</label>
            <input className="input" style={{ width: 90 }} value={cc} onChange={(e) => setCc(e.target.value.replace(/\D/g, ""))} /></div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={lbl}>2) نص الرسالة</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {templates.map((t) => (
              <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 8px" }} onClick={() => setBody(t.body_template)}>{t.name}</button>
                <button onClick={() => deleteTemplate(t.id)} title="حذف القالب" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={13} /></button>
              </span>
            ))}
          </div>
          <textarea className="input" rows={4} style={{ width: "100%", maxWidth: 620 }} value={body} onChange={(e) => setBody(e.target.value)} />
          <div style={{ fontSize: "0.78rem", color: "var(--steel)", margin: "4px 0 8px" }}>
            المتغيرات: {TOKENS.map((t) => (
              <button key={t} className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "1px 6px", marginInlineEnd: 4 }} onClick={() => setBody((b) => b + `{${t}}`)}>{`{${t}}`}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" style={{ maxWidth: 220 }} placeholder="اسم القالب للحفظ" value={tplName} onChange={(e) => setTplName(e.target.value)} />
            <button className="btn btn-secondary" onClick={saveTemplate}><Save size={14} /> حفظ كقالب</button>
          </div>
        </div>
      </div>

      {exam && !queue && (
        <div className="card" style={{ padding: "1rem 1.1rem" }}>
          <label style={lbl}>3) المراجعة — الكل محدد، أزل علامة من لا تريد إرسال رسالة له</label>
          {loading ? <p>جارٍ التحميل...</p> : rows.length === 0 ? <p style={{ color: "var(--steel)" }}>لا طلاب مسجلون بهذه الشعبة.</p> : (
            <>
              <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
                <button className="btn btn-secondary" onClick={() => selectAll(true)}>تحديد الكل</button>
                <button className="btn btn-secondary" onClick={() => selectAll(false)}>إلغاء الكل</button>
              </div>
              <table className="data-table">
                <thead><tr><th></th><th>الطالب</th><th>هاتف الولي</th><th>العلامة</th><th>الرسالة</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.studentId} style={{ opacity: sendable(r) ? 1 : 0.55 }}>
                      <td><input type="checkbox" disabled={!sendable(r)} checked={checked.has(r.studentId) && sendable(r)} onChange={() => toggle(r.studentId)} /></td>
                      <td>{r.name}{r.sentBefore && <span style={{ color: "var(--gold-dark)", fontSize: "0.75rem" }}> — أُرسل سابقاً</span>}</td>
                      <td dir="ltr" style={{ textAlign: "right" }}>{r.phone ? `+${r.phone}` : <span style={{ color: "var(--red)" }}>{r.rawPhone ? "رقم غير صالح" : "لا رقم"}</span>}</td>
                      <td>{r.score === null ? <span style={{ color: "var(--red)" }}>لا علامة</span> : fmt(r.score)}</td>
                      <td style={{ fontSize: "0.8rem", maxWidth: 360 }}>
                        {editing === r.studentId ? (
                          <textarea className="input" rows={4} style={{ width: "100%" }} value={messageFor(r)}
                            onChange={(e) => setOverride((o) => ({ ...o, [r.studentId]: e.target.value }))} onBlur={() => setEditing(null)} autoFocus />
                        ) : (
                          <span style={{ cursor: "pointer", whiteSpace: "pre-wrap" }} title="اضغط لتعديل رسالة هذا الطالب" onClick={() => sendable(r) && setEditing(r.studentId)}>
                            {messageFor(r).slice(0, 90)}{messageFor(r).length > 90 ? "…" : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
                <button className="btn btn-gold" disabled={selected.length === 0} onClick={prepareSend}><MessageCircle size={14} /> إرسال {selected.length} رسالة عبر واتساب</button>
                <span style={{ fontSize: "0.78rem", color: "var(--steel)" }}>لن تُرسل الرسائل بلا رقم صالح أو بلا علامة.</span>
              </div>
            </>
          )}
        </div>
      )}

      {queue && (
        <div className="card" style={{ padding: "1rem 1.1rem" }}>
          <p style={{ marginTop: 0 }}>
            تم فتح {queue.filter((x) => x.state === "opened").length} من {queue.length}. في كل مرة يفتح واتساب برسالة جاهزة — اضغط «إرسال» داخل واتساب ثم ارجع هنا.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="btn btn-gold" disabled={!nextPending} onClick={() => nextPending && openOne(nextPending)}><MessageCircle size={14} /> فتح التالي{nextPending ? `: ${nextPending.name}` : ""}</button>
            <button className="btn btn-secondary" onClick={() => { setQueue(null); if (exam) loadRoster(exam, cc); }}>إنهاء</button>
          </div>
          <table className="data-table">
            <thead><tr><th>الطالب</th><th>الهاتف</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.logId}>
                  <td>{q.name}</td>
                  <td dir="ltr" style={{ textAlign: "right" }}>+{q.phone}</td>
                  <td style={{ color: q.state === "opened" ? "var(--green)" : q.state === "failed" ? "var(--red)" : "var(--steel)", fontWeight: 700 }}>
                    {q.state === "opened" ? "فُتح واتساب ✓" : q.state === "failed" ? "فشل" : "بالانتظار"}
                  </td>
                  <td>
                    {q.state !== "opened" && <button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 8px" }} onClick={() => openOne(q)}>فتح واتساب</button>}
                    {q.state === "pending" && <button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 8px", marginInlineStart: 4 }} onClick={() => markFailed(q)}>تخطي</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
