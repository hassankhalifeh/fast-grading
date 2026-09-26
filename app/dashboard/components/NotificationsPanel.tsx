"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { MESSAGE_TYPES, fmtNum, normalizePhone, paramsFromBody, render, typeByKey, type MessageType } from "@/lib/messageTypes";
import BatchView from "./BatchView";
import { FilePlus2 } from "lucide-react";
import { useTableKit } from "@/lib/tablekit";

interface Named { id: string; name: string }
interface ExamRow { id: string; exam_name: string; exam_date: string | null; max_score: number; class_section_id: string; subject_id: string; class_sections: { name: string } | null; subjects: { name: string } | null }
interface TplRow { message_type: string; body_template: string; wa_template_name: string | null; wa_language: string; wa_status: string; moderation_status: string }
interface Rec { studentId: string; name: string; phone: string; values: Record<string, string>; included: boolean }
interface BatchRow { id: string; message_type: string; title: string; status: string; created_at: string; created_by: string }

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const STATUS_LABEL: Record<string, string> = { draft: "مسودة", approved: "معتمدة", rejected: "مرفوضة", cancelled: "ملغاة" };
const BATCH_COLUMNS = [{ key: "title", label: "الدفعة" }, { key: "type_label", label: "النوع" }, { key: "status_label", label: "الحالة" }, { key: "date_text", label: "التاريخ" }];

// قائمة الدفعات (مسودات أو سجل) مع بحث وفلترة؛ مكوّن مستقل ليكون لكل قائمة حالتها
function BatchList({ rows, onOpen }: { rows: BatchRow[]; onOpen: (id: string) => void }) {
  const shaped = useMemo(() => rows.map((b) => ({
    ...b, type_label: typeByKey(b.message_type)?.label ?? b.message_type, status_label: STATUS_LABEL[b.status] ?? b.status, date_text: new Date(b.created_at).toLocaleDateString("ar"),
  })), [rows]);
  const tk = useTableKit(shaped, BATCH_COLUMNS);
  if (rows.length === 0) return <p style={{ color: "var(--steel)" }}>لا يوجد شيء هنا.</p>;
  return (
    <>
      {tk.toolbar}
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>الدفعة</th><th>النوع</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
          <tbody>
            {tk.rows.map((b) => (
              <tr key={b.id}>
                <td>{b.title}</td><td>{b.type_label}</td><td>{b.status_label}</td><td>{b.date_text}</td>
                <td><button className="btn btn-secondary" style={{ fontSize: "0.78rem", padding: "3px 10px" }} onClick={() => onOpen(b.id)}>فتح</button></td>
              </tr>
            ))}
            {tk.active && tk.rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--steel)" }}>لا نتائج مطابقة للبحث.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function friendly(m: string) {
  if (m.includes("row-level security")) return "ليس لديك صلاحية إعداد الرسائل";
  return m;
}

// مراسلات أولياء الأمور: تحضير مسودة من قوالب المدرسة ← مراجعة/تعديل استثنائي ← اعتماد ← إرسال.
export default function NotificationsPanel({ accountId, appUser, canApprove, canSend }: { accountId: string; appUser: AppUser; canApprove: boolean; canSend: boolean }) {
  const [tab, setTab] = useState<"prepare" | "drafts" | "history">("prepare");
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [classes, setClasses] = useState<Named[]>([]);
  const [terms, setTerms] = useState<Named[]>([]);
  const [sessions, setSessions] = useState<Named[]>([]);
  const [templates, setTemplates] = useState<TplRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [cc, setCc] = useState("961");
  const [school, setSchool] = useState("المدرسة");
  const [pass, setPass] = useState(50);
  const [waConfigured, setWaConfigured] = useState(false);

  const [typeKey, setTypeKey] = useState(MESSAGE_TYPES[0].key);
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [termId, setTermId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [dateText, setDateText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const type = typeByKey(typeKey) as MessageType;

  async function loadBase() {
    const [ex, cl, tm, se, tp, ac, ss, gp] = await Promise.all([
      supabase.from("exams").select("id, exam_name, exam_date, max_score, class_section_id, subject_id, class_sections(name), subjects(name)").eq("account_id", accountId).order("exam_date", { ascending: false, nullsFirst: false }).limit(200),
      supabase.from("class_sections").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("terms").select("id, name, order_index").eq("account_id", accountId).order("order_index"),
      supabase.from("supplementary_sessions").select("id, name").eq("account_id", accountId).order("created_at", { ascending: false }),
      supabase.from("notification_templates").select("message_type, body_template, wa_template_name, wa_language, wa_status, moderation_status").eq("account_id", accountId),
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
      supabase.from("school_settings").select("country_code").eq("account_id", accountId).maybeSingle(),
      supabase.from("grading_policies").select("passing_threshold_percent").eq("account_id", accountId).maybeSingle(),
    ]);
    setExams((ex.data ?? []) as unknown as ExamRow[]);
    setClasses((cl.data ?? []) as Named[]);
    setTerms((tm.data ?? []) as Named[]);
    setSessions((se.data ?? []) as Named[]);
    setTemplates((tp.data ?? []) as TplRow[]);
    if (ac.data?.display_name) setSchool(ac.data.display_name);
    if (ss.data?.country_code) setCc(ss.data.country_code);
    if (gp.data?.passing_threshold_percent != null) setPass(Number(gp.data.passing_threshold_percent));
  }
  async function loadBatches() {
    const { data } = await supabase.from("notification_batches").select("id, message_type, title, status, created_at, created_by").eq("account_id", accountId).order("created_at", { ascending: false }).limit(100);
    setBatches((data ?? []) as BatchRow[]);
  }
  useEffect(() => { loadBase(); loadBatches(); }, [accountId]);
  useEffect(() => {
    supabase.functions.invoke("send-whatsapp", { body: { action: "status" } }).then(({ data, error: e }) => setWaConfigured(!e && !!data?.configured));
  }, []);

  // ---- مصادر المستلمين لكل نوع
  async function studentValues(ids: string[], per: Map<string, Record<string, string>>, defaults: Record<string, boolean>) {
    const { data } = await supabase.from("students").select("id, full_name, parent_name, parent_phone").in("id", ids);
    const recs: Rec[] = []; let noPhone = 0;
    (data ?? []).forEach((s: any) => {
      const phone = normalizePhone(s.parent_phone, cc);
      if (!phone) { noPhone++; return; }
      recs.push({
        studentId: s.id, name: s.full_name, phone, included: defaults[s.id] ?? true,
        values: { ...(per.get(s.id) ?? {}), الولي: s.parent_name || "ولي الأمر", الطالب: s.full_name, المدرسة: school },
      });
    });
    return { recs, noPhone };
  }

  async function build(): Promise<{ recs: Rec[]; title: string; examId: string | null; notes: string[] } | string> {
    const per = new Map<string, Record<string, string>>(); const inc: Record<string, boolean> = {}; const notes: string[] = [];
    const clsName = (id: string) => classes.find((c) => c.id === id)?.name ?? "";

    if (type.source === "exam") {
      const e = exams.find((x) => x.id === examId);
      if (!e) return "اختر الامتحان";
      const [enr, gr] = await Promise.all([
        supabase.from("class_enrollments").select("student_id").eq("class_section_id", e.class_section_id).eq("status", "active"),
        supabase.from("grades").select("student_id, score").eq("exam_id", e.id).eq("status", "confirmed"),
      ]);
      const tot = new Map<string, number>();
      (gr.data ?? []).forEach((g: any) => { if (g.score !== null) tot.set(g.student_id, (tot.get(g.student_id) ?? 0) + Number(g.score)); });
      const ids = (enr.data ?? []).map((r: any) => r.student_id).filter((id: string) => tot.has(id));
      const noGrade = (enr.data ?? []).length - ids.length;
      if (noGrade > 0) notes.push(`${noGrade} طالب بلا علامة معتمدة (استُبعدوا)`);
      const max = Number(e.max_score);
      ids.forEach((id: string) => {
        const sc = tot.get(id)!;
        per.set(id, { المادة: e.subjects?.name ?? "", الامتحان: e.exam_name, العلامة: fmtNum(sc), الحد: fmtNum(max), الصف: e.class_sections?.name ?? "" });
        inc[id] = typeKey === "grade_low" ? (sc / max) * 100 < pass : true;
      });
      const r = await studentValues(ids, per, inc);
      if (r.noPhone > 0) notes.push(`${r.noPhone} طالب بلا رقم ولي أمر صالح (استُبعدوا)`);
      return { recs: r.recs, title: `${type.label} — ${e.class_sections?.name} · ${e.subjects?.name} · ${e.exam_name}`, examId: e.id, notes };
    }

    if (type.source === "term") {
      if (!classId || !termId) return "اختر الشعبة والفصل";
      const { data } = await supabase.from("v_student_class_rank").select("student_id, term_average, rank_in_class, class_size").eq("class_section_id", classId).eq("term_id", termId);
      const ids = (data ?? []).map((r: any) => r.student_id);
      (data ?? []).forEach((r: any) => per.set(r.student_id, {
        الفصل: terms.find((t) => t.id === termId)?.name ?? "", المعدل: fmtNum(Number(r.term_average)), الترتيب: String(r.rank_in_class), عدد_الطلاب: String(r.class_size), الصف: clsName(classId),
      }));
      const r = await studentValues(ids, per, {});
      if (r.noPhone > 0) notes.push(`${r.noPhone} طالب بلا رقم ولي أمر صالح (استُبعدوا)`);
      return { recs: r.recs, title: `${type.label} — ${clsName(classId)} · ${terms.find((t) => t.id === termId)?.name}`, examId: null, notes };
    }

    if (type.source === "supplementary") {
      if (!sessionId) return "اختر الدور التكميلي";
      if (!dateText.trim()) return "اكتب موعد الامتحان التكميلي";
      const [el, sj] = await Promise.all([
        supabase.from("supplementary_eligibility").select("student_id, subject_id").eq("session_id", sessionId),
        supabase.from("subjects").select("id, name").eq("account_id", accountId),
      ]);
      const subj = new Map((sj.data ?? []).map((s: any) => [s.id, s.name]));
      const bySt = new Map<string, string[]>();
      (el.data ?? []).forEach((r: any) => bySt.set(r.student_id, [...(bySt.get(r.student_id) ?? []), subj.get(r.subject_id) ?? ""]));
      bySt.forEach((list, id) => per.set(id, { المواد: list.filter(Boolean).join(" و"), الموعد: dateText.trim() }));
      const r = await studentValues([...bySt.keys()], per, {});
      if (r.noPhone > 0) notes.push(`${r.noPhone} طالب بلا رقم ولي أمر صالح (استُبعدوا)`);
      return { recs: r.recs, title: `${type.label} — ${sessions.find((s) => s.id === sessionId)?.name}`, examId: null, notes };
    }

    // promotion
    if (!sessionId || !classId) return "اختر الدور والشعبة";
    const { data } = await supabase.from("v_student_promotion").select("student_id, promoted, failed_after").eq("session_id", sessionId).eq("class_section_id", classId);
    const ids = (data ?? []).map((r: any) => r.student_id);
    (data ?? []).forEach((r: any) => per.set(r.student_id, { النتيجة: r.promoted ? "مُرفَّع" : "غير مُرفَّع", الصف: clsName(classId) }));
    const r = await studentValues(ids, per, {});
    if (r.noPhone > 0) notes.push(`${r.noPhone} طالب بلا رقم ولي أمر صالح (استُبعدوا)`);
    return { recs: r.recs, title: `${type.label} — ${clsName(classId)} · ${sessions.find((s) => s.id === sessionId)?.name}`, examId: null, notes };
  }

  async function createDraft() {
    setError(null); setInfo(null); setBusy(true);
    const res = await build();
    if (typeof res === "string") { setBusy(false); return setError(res); }
    if (res.recs.length === 0) { setBusy(false); return setError("لا يوجد مستلمون مؤهلون" + (res.notes.length ? ": " + res.notes.join("، ") : "")); }

    const found = templates.find((t) => t.message_type === typeKey);
    // صياغة المدرسة المحجوبة (ألفاظ غير لائقة) لا تُستعمل: تُستعمل الصياغة الافتراضية حتى تُصحَّح
    const tplBlocked = !!found && found.moderation_status === "blocked";
    const tpl = tplBlocked ? undefined : found;
    const body = tpl?.body_template ?? type.body;
    const waOk = !!tpl && tpl.wa_status === "approved" && !!tpl.wa_template_name;

    const { data: batch, error: e1 } = await supabase.from("notification_batches")
      .insert({ account_id: accountId, message_type: typeKey, title: res.title, exam_id: res.examId, created_by: appUser.id }).select("id").single();
    if (e1 || !batch) { setBusy(false); return setError(friendly(e1?.message ?? "تعذّر إنشاء المسودة")); }

    const rows = res.recs.map((r) => ({
      account_id: accountId, student_id: r.studentId, exam_id: res.examId, channel: "whatsapp", rendered_message: render(body, r.values), status: "pending",
      to_phone: r.phone, batch_id: batch.id, sent_by: appUser.id, message_type: typeKey, included: r.included,
      ...(waOk ? { wa_template_name: tpl!.wa_template_name, wa_language: tpl!.wa_language, wa_params: paramsFromBody(body, r.values) } : {}),
    }));
    const { error: e2 } = await supabase.from("notifications_log").insert(rows);
    setBusy(false);
    if (e2) {
      await supabase.from("notification_batches").update({ status: "rejected", review_note: "فشل إنشاء الرسائل" }).eq("id", batch.id);
      return setError(friendly(e2.message));
    }
    loadBatches();
    const warn = tplBlocked ? "صياغة مدرستكم لهذا النوع محجوبة لاحتوائها ألفاظاً غير لائقة، فاستُعملت الصياغة الافتراضية. صحّحوها من «قوالب الرسائل». " : "";
    setInfo(warn + (res.notes.length ? res.notes.join("، ") : "") || null);
    setOpenBatch(batch.id);
  }

  if (openBatch) {
    return <BatchView batchId={openBatch} appUser={appUser} canApprove={canApprove} canSend={canSend} waConfigured={waConfigured}
      onBack={() => { setOpenBatch(null); loadBatches(); }} />;
  }

  const drafts = batches.filter((b) => b.status === "draft");
  const history = batches.filter((b) => b.status !== "draft");
  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className="btn"
      style={{ background: tab === id ? "var(--indigo)" : "white", color: tab === id ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)", padding: "8px 18px" }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {tabBtn("prepare", "تحضير رسائل")}{tabBtn("drafts", `المسودات (${drafts.length})`)}{tabBtn("history", "المعتمدة والسجل")}
      </div>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {info && <p style={{ color: "var(--gold-dark)" }}>{info}</p>}

      {tab === "prepare" && (
        <div className="card" style={{ padding: "1rem 1.1rem" }}>
          {!canSend && <p style={{ color: "var(--red)" }}>لا تملك صلاحية إعداد الرسائل (notifications.send).</p>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={lbl}>نوع المراسلة</label>
              <select className="input" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
                {MESSAGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select></div>
            {type.source === "exam" && (
              <div><label style={lbl}>الامتحان</label>
                <select className="input" style={{ minWidth: 300 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {exams.map((x) => <option key={x.id} value={x.id}>{x.class_sections?.name} · {x.subjects?.name} · {x.exam_name}{x.exam_date ? ` (${x.exam_date})` : ""}</option>)}
                </select></div>
            )}
            {(type.source === "term" || type.source === "promotion") && (
              <div><label style={lbl}>الشعبة</label>
                <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">— اختر —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            )}
            {type.source === "term" && (
              <div><label style={lbl}>الفصل</label>
                <select className="input" value={termId} onChange={(e) => setTermId(e.target.value)}>
                  <option value="">— اختر —</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
            )}
            {(type.source === "supplementary" || type.source === "promotion") && (
              <div><label style={lbl}>الدور التكميلي</label>
                <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  <option value="">— اختر —</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
            )}
            {type.source === "supplementary" && (
              <div><label style={lbl}>موعد الامتحان (نص يظهر في الرسالة)</label>
                <input className="input" value={dateText} placeholder="مثلاً: الاثنين 15 أيلول الساعة 9" onChange={(e) => setDateText(e.target.value)} /></div>
            )}
            <button className="btn btn-gold" disabled={busy || !canSend} onClick={createDraft}><FilePlus2 size={14} /> {busy ? "جارٍ التحضير..." : "إنشاء مسودة للمراجعة"}</button>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--steel)", marginBottom: 0 }}>
            {type.hint} يُنشأ نص كل رسالة من صياغة مدرستك (قوالب الرسائل)، ثم تفتح المسودة للمراجعة: الجميع محدد وتُزيل من لا تريد وتُعدّل ما يلزم، ولا يُرسل شيء قبل الاعتماد.
          </p>
        </div>
      )}
      {tab === "drafts" && <BatchList rows={drafts} onOpen={setOpenBatch} />}
      {tab === "history" && <BatchList rows={history} onOpen={setOpenBatch} />}
    </div>
  );
}
