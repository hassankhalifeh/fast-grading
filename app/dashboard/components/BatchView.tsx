"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { typeByKey } from "@/lib/messageTypes";
import { CheckCircle2, MessageCircle, XCircle } from "lucide-react";
import { useTableKit } from "@/lib/tablekit";

interface Batch { id: string; message_type: string; title: string; status: string; created_by: string; approved_by: string | null; approved_at: string | null; review_note: string | null; created_at: string }
interface Msg {
  id: string; student_id: string; to_phone: string; rendered_message: string; status: string; included: boolean; edited: boolean;
  moderation_status: "clean" | "blocked"; wa_template_name: string | null; delivery_status: string | null; error_text: string | null; provider_message_id: string | null; students: { full_name: string } | null;
}
const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "مسودة — بانتظار المراجعة والاعتماد", color: "var(--gold-dark)" },
  approved: { label: "معتمدة", color: "var(--green)" },
  rejected: { label: "مرفوضة", color: "var(--red)" },
  cancelled: { label: "ملغاة", color: "var(--red)" },
};
const DELIVERY: Record<string, string> = { accepted: "قُبلت لدى واتساب", delivered: "سُلّمت", read: "قُرئت", failed: "فشلت" };
const MSG_COLUMNS = [{ key: "student", label: "الطالب" }, { key: "phone", label: "الهاتف" }, { key: "rendered_message", label: "الرسالة" }, { key: "status_text", label: "الحالة" }];
const msgStatusText = (m: Msg) =>
  !m.included ? "مستبعدة" : m.moderation_status === "blocked" ? "محجوبة" : m.status === "sent" ? (m.provider_message_id ? (DELIVERY[m.delivery_status ?? ""] ?? "أُرسلت") : "فُتح واتساب ✓") : m.status === "failed" ? "فشلت" : "بانتظار الإرسال";

function friendly(m: string) {
  if (m.includes("row-level security")) return "ليس لديك صلاحية لهذا الإجراء";
  return m;
}

// مراجعة دفعة رسائل: تحديد/إلغاء المستلمين وتعديل النص استثنائياً ثم الاعتماد، وبعده فقط الإرسال (تلقائي للرسائل المؤهلة، ويدوي للباقي).
export default function BatchView({ batchId, appUser, canApprove, canSend, waConfigured, onBack }: {
  batchId: string; appUser: AppUser; canApprove: boolean; canSend: boolean; waConfigured: boolean; onBack: () => void;
}) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"self" | "other">("self");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fail = (m: string) => { setMessage(null); setError(friendly(m)); };
  const ok = (m: string) => { setError(null); setMessage(m); };

  async function load() {
    const [b, m, st] = await Promise.all([
      supabase.from("notification_batches").select("*").eq("id", batchId).maybeSingle(),
      supabase.from("notifications_log")
        .select("id, student_id, to_phone, rendered_message, status, included, edited, moderation_status, wa_template_name, delivery_status, error_text, provider_message_id, students(full_name)")
        .eq("batch_id", batchId).order("created_at"),
      supabase.from("school_settings").select("approval_mode").eq("account_id", appUser.account_id).maybeSingle(),
    ]);
    const bt = b.data as Batch | null;
    setBatch(bt);
    setMsgs(((m.data ?? []) as unknown as Msg[]).sort((x, y) => (x.students?.full_name ?? "").localeCompare(y.students?.full_name ?? "", "ar")));
    setMode((st.data?.approval_mode as "self" | "other") ?? "self");
    if (bt) {
      const ids = [bt.created_by, bt.approved_by].filter(Boolean) as string[];
      const { data } = await supabase.from("app_users").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries((data ?? []).map((u: any) => [u.id, u.full_name])));
    }
  }
  useEffect(() => { load(); }, [batchId]);

  const who = (id: string | null) => (!id ? "—" : id === appUser.id ? "أنت" : names[id] ?? "مستخدم آخر");
  const included = msgs.filter((m) => m.included);
  const blockedIncluded = included.filter((m) => m.moderation_status === "blocked");
  const type = batch ? typeByKey(batch.message_type) : undefined;

  async function toggle(m: Msg) {
    const { error: e } = await supabase.from("notifications_log").update({ included: !m.included }).eq("id", m.id);
    if (e) return fail(e.message);
    setMsgs((p) => p.map((x) => (x.id === m.id ? { ...x, included: !x.included } : x)));
  }
  async function saveEdit(m: Msg) {
    setEditing(null);
    if (draftText.trim() === m.rendered_message.trim() || !draftText.trim()) return;
    const { error: e } = await supabase.from("notifications_log").update({ rendered_message: draftText.trim() }).eq("id", m.id);
    if (e) return fail(e.message);
    load();
  }

  const selfBlocked = mode === "other" && batch?.created_by === appUser.id;
  async function approve() {
    setBusy(true);
    const { error: e } = await supabase.from("notification_batches").update({ status: "approved" }).eq("id", batchId);
    setBusy(false);
    if (e) return fail(e.message);
    ok("اعتُمدت الدفعة — يمكن الآن الإرسال"); load();
  }
  async function setStatus(status: "rejected" | "cancelled") {
    setBusy(true);
    const { error: e } = await supabase.from("notification_batches").update({ status, review_note: note.trim() || null }).eq("id", batchId);
    setBusy(false);
    if (e) return fail(e.message);
    ok(status === "rejected" ? "رُفضت المسودة" : "أُلغيت الدفعة"); load();
  }

  // الإرسال التلقائي: الرسائل المؤهلة فقط (قالب معتمد وغير معدّلة)
  const autoRows = msgs.filter((m) => m.included && m.status === "pending" && m.wa_template_name);
  const manualRows = useMemo(
    () => msgs.filter((m) => m.included && (m.status === "failed" || (m.status === "pending" && (!waConfigured || !m.wa_template_name)))),
    [msgs, waConfigured],
  );
  async function sendAuto() {
    setBusy(true);
    const { data, error: e } = await supabase.functions.invoke("send-whatsapp", { body: { batch_id: batchId } });
    setBusy(false);
    if (e || data?.error) return fail(data?.error === "not_configured" ? "الإرسال التلقائي غير مفعّل بعد" : data?.error ?? e?.message ?? "تعذّر الإرسال");
    ok(`أُرسلت ${data.sent} رسالة، وفشلت ${data.failed}`); load();
  }
  async function openManual(m: Msg) {
    const link = `https://wa.me/${m.to_phone}?text=${encodeURIComponent(m.rendered_message)}`;
    window.open(link, "_blank", "noopener");
    const { error: e } = await supabase.from("notifications_log").update({ status: "sent", sent_at: new Date().toISOString(), error_text: null }).eq("id", m.id);
    if (e) return fail(e.message);
    load();
  }
  const nextManual = manualRows.find((m) => m.status === "pending") ?? null;
  const msgRows = useMemo(() => msgs.map((m) => ({ ...m, student: m.students?.full_name ?? "—", phone: `+${m.to_phone}`, status_text: msgStatusText(m) })), [msgs]);
  const tk = useTableKit(msgRows, MSG_COLUMNS);

  if (!batch) return <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p>;
  const st = STATUS[batch.status] ?? { label: batch.status, color: "var(--steel)" };
  const isDraft = batch.status === "draft";

  return (
    <div>
      <button className="btn btn-secondary" onClick={onBack} style={{ marginBottom: 10 }}>← رجوع</button>
      <h3 style={{ margin: "0 0 4px" }}>{batch.title}</h3>
      <p style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>
        <b style={{ color: st.color }}>{st.label}</b> · النوع: {type?.label ?? batch.message_type} · أعدّها: {who(batch.created_by)}
        {batch.approved_by && <> · اعتمدها: {who(batch.approved_by)}</>}
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      {isDraft && (
        <p style={{ fontSize: "0.85rem", color: "var(--steel)", margin: "0 0 8px" }}>
          راجع الرسائل: أزل علامة من لا تريد إرسال رسالة له، واضغط على أي نص لتعديله استثنائياً (الرسالة المعدّلة تُرسل يدوياً عبر واتساب لأنها تخرج عن القالب المعتمد). لا يُرسل شيء قبل الاعتماد.
        </p>
      )}

      {tk.toolbar}
      <div className="card" style={{ overflowX: "auto", marginBottom: 12 }}>
        <table className="data-table">
          <thead><tr>{isDraft && <th></th>}<th>الطالب</th><th>الهاتف</th><th>الرسالة</th><th>الحالة</th></tr></thead>
          <tbody>
            {tk.rows.map((m) => (
              <tr key={m.id} style={{ opacity: m.included ? 1 : 0.45, background: m.moderation_status === "blocked" && m.included ? "rgba(220,38,38,0.07)" : undefined }}>
                {isDraft && <td><input type="checkbox" checked={m.included} onChange={() => toggle(m)} /></td>}
                <td>{m.students?.full_name ?? "—"}</td>
                <td dir="ltr" style={{ textAlign: "right" }}>+{m.to_phone}</td>
                <td style={{ fontSize: "0.82rem", maxWidth: 420, whiteSpace: "pre-wrap" }}>
                  {editing === m.id ? (
                    <textarea className="input" rows={5} style={{ width: "100%" }} value={draftText} autoFocus
                      onChange={(e) => setDraftText(e.target.value)} onBlur={() => saveEdit(m)} />
                  ) : (
                    <span style={{ cursor: isDraft && m.included ? "pointer" : "default" }} title={isDraft ? "اضغط لتعديل هذه الرسالة" : undefined}
                      onClick={() => { if (isDraft && m.included) { setEditing(m.id); setDraftText(m.rendered_message); } }}>{m.rendered_message}</span>
                  )}
                  {m.edited && <div style={{ color: "var(--gold-dark)", fontSize: "0.72rem" }}>معدّلة استثنائياً</div>}
                  {m.moderation_status === "blocked" && <div style={{ color: "var(--red)", fontSize: "0.75rem", fontWeight: 700 }}>⛔ محجوبة: تحوي ألفاظاً غير لائقة (سُجّلت مخالفة) — عدّل النص أو استبعدها</div>}
                </td>
                <td style={{ fontSize: "0.8rem", fontWeight: 700, color: m.status === "sent" ? "var(--green)" : m.status === "failed" ? "var(--red)" : "var(--steel)" }}>
                  {m.status_text}
                  {m.error_text && <div style={{ fontWeight: 400, color: "var(--red)" }}>{m.error_text}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-gold" disabled={busy || !canApprove || selfBlocked || included.length === 0 || blockedIncluded.length > 0} onClick={approve}>
            <CheckCircle2 size={14} /> اعتماد {included.length} رسالة
          </button>
          <input className="input" style={{ maxWidth: 220 }} placeholder="سبب الرفض (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-secondary" disabled={busy || !canApprove} onClick={() => setStatus("rejected")}><XCircle size={14} /> رفض المسودة</button>
          {blockedIncluded.length > 0 && <span style={{ fontSize: "0.8rem", color: "var(--red)" }}>لا يمكن الاعتماد: {blockedIncluded.length} رسالة محجوبة لمحتوى غير لائق.</span>}
          {!canApprove && <span style={{ fontSize: "0.8rem", color: "var(--red)" }}>لا تملك صلاحية «اعتماد الرسائل».</span>}
          {canApprove && selfBlocked && <span style={{ fontSize: "0.8rem", color: "var(--red)" }}>إعدادات المدرسة تشترط أن يعتمدها شخص آخر غير من أعدّها.</span>}
        </div>
      )}

      {batch.status === "approved" && (
        <div>
          {canSend && waConfigured && autoRows.length > 0 && (
            <button className="btn btn-gold" disabled={busy} onClick={sendAuto} style={{ marginInlineEnd: 8 }}><MessageCircle size={14} /> إرسال تلقائي ({autoRows.length})</button>
          )}
          {canSend && manualRows.length > 0 && (
            <>
              <button className="btn btn-gold" disabled={!nextManual} onClick={() => nextManual && openManual(nextManual)}>
                <MessageCircle size={14} /> فتح واتساب للتالي{nextManual ? `: ${nextManual.students?.full_name ?? ""}` : ""}
              </button>
              <div style={{ margin: "8px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {manualRows.map((m) => (
                  <button key={m.id} className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 8px" }} onClick={() => openManual(m)}>
                    {m.students?.full_name}{m.status === "failed" ? " (إعادة)" : ""}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--steel)" }}>«فُتح واتساب» يعني أن الرسالة فُتحت جاهزة للإرسال، وأنت من يضغط «إرسال» داخل واتساب.</p>
            </>
          )}
          {canApprove && <button className="btn btn-secondary" disabled={busy} onClick={() => setStatus("cancelled")} style={{ marginTop: 8 }}>إلغاء الدفعة</button>}
        </div>
      )}
      {batch.review_note && <p style={{ fontSize: "0.82rem", color: "var(--steel)" }}>ملاحظة: {batch.review_note}</p>}
    </div>
  );
}
