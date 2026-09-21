"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Trash2 } from "lucide-react";

interface Violation {
  id: string; occurred_at: string; user_id: string | null; user_name: string | null; context: string; message_type: string | null; student_name: string | null;
  matched_terms: string[]; categories: string[]; excerpt: string | null; review_status: "open" | "confirmed" | "dismissed"; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
}
interface Term { id: string; term: string; category: string; kind: "block" | "allow"; active: boolean }

export const CATEGORY_LABEL: Record<string, string> = { sexual: "خادش للحياء", profanity: "ألفاظ نابية", insult: "إهانة", threat: "تهديد", other: "أخرى" };
const CONTEXT_LABEL: Record<string, string> = { template: "قالب رسائل", draft_message: "رسالة في مسودة", edited_message: "تعديل استثنائي على رسالة" };
const STATUS_LABEL = { open: "بانتظار المراجعة", confirmed: "مخالفة مؤكدة", dismissed: "مرفوضة (إنذار كاذب)" } as const;
const STATUS_COLOR = { open: "var(--gold-dark)", confirmed: "var(--red)", dismissed: "var(--steel)" } as const;
const fmtDT = (s: string) => new Date(s).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// مراجعة المخالفات: كل نص يحوي ألفاظاً خادشة للحياء يُحجب تلقائياً وتُسجَّل مخالفة دائمة (بالنص والمستخدم والوقت) لتراجعها الإدارة وتحاسب عليها.
export default function ModerationPanel() {
  const [list, setList] = useState<Violation[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newTerm, setNewTerm] = useState("");
  const [newCat, setNewCat] = useState("insult");
  const [newKind, setNewKind] = useState<"block" | "allow">("block");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [v, t, me] = await Promise.all([
      supabase.from("message_violations").select("*").order("occurred_at", { ascending: false }).limit(500),
      supabase.from("moderation_terms").select("id, term, category, kind, active").order("created_at", { ascending: false }),
      supabase.rpc("current_account_id"),
    ]);
    if (v.error) setError(v.error.message.includes("permission") ? "ليس لديك صلاحية عرض المخالفات" : v.error.message);
    setList((v.data ?? []) as Violation[]); setTerms((t.data ?? []) as Term[]); setAccountId((me.data as string) ?? null);
  }
  useEffect(() => { load(); }, []);

  const shown = list.filter((v) => filter === "all" || v.review_status === "open");
  const perUser = useMemo(() => {
    const m = new Map<string, { name: string; total: number; confirmed: number }>();
    list.forEach((v) => {
      const k = v.user_id ?? "—";
      const cur = m.get(k) ?? { name: v.user_name ?? "غير معروف", total: 0, confirmed: 0 };
      cur.total++; if (v.review_status === "confirmed") cur.confirmed++;
      m.set(k, cur);
    });
    return [...m.values()].sort((a, b) => b.confirmed - a.confirmed || b.total - a.total);
  }, [list]);

  async function review(id: string, status: "confirmed" | "dismissed" | "open") {
    setError(null);
    const { error: e } = await supabase.rpc("review_violation", { p_id: id, p_status: status, p_note: notes[id] ?? "" });
    if (e) return setError(e.message);
    setMessage("سُجّلت المراجعة"); load();
  }
  async function addTerm() {
    if (!newTerm.trim() || !accountId) return;
    setError(null);
    const { error: e } = await supabase.from("moderation_terms").insert({ account_id: accountId, term: newTerm.trim(), category: newCat, kind: newKind });
    if (e) return setError(e.message.includes("duplicate") ? "المصطلح موجود مسبقاً" : e.message.includes("row-level") ? "ليس لديك صلاحية تعديل القاموس" : e.message);
    setNewTerm(""); setMessage("أُضيف المصطلح"); load();
  }
  async function removeTerm(id: string) {
    const { error: e } = await supabase.from("moderation_terms").delete().eq("id", id);
    if (e) return setError(e.message);
    load();
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>
        أي رسالة أو قالب يحوي ألفاظاً خادشة للحياء (جنسية، نابية، إهانة، تهديد) <b>يُحجب تلقائياً</b>: لا يمكن اعتماده ولا إرساله، وتُسجَّل <b>مخالفة دائمة</b> بالنص والمستخدم والوقت. لا تُحذف المخالفات ولا تُعدَّل؛ تُراجَع فقط (تأكيد أو رفض مع ملاحظة).
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}

      {perUser.length > 0 && (
        <div className="card" style={{ overflowX: "auto", marginBottom: 14 }}>
          <table className="data-table">
            <thead><tr><th>المستخدم</th><th>عدد المخالفات</th><th>المؤكدة</th></tr></thead>
            <tbody>{perUser.map((u, i) => <tr key={i}><td>{u.name}</td><td>{u.total}</td><td style={{ color: u.confirmed ? "var(--red)" : undefined, fontWeight: u.confirmed ? 700 : 400 }}>{u.confirmed}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="btn" onClick={() => setFilter("open")} style={{ background: filter === "open" ? "var(--indigo)" : "white", color: filter === "open" ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)" }}>بانتظار المراجعة ({list.filter((v) => v.review_status === "open").length})</button>
        <button className="btn" onClick={() => setFilter("all")} style={{ background: filter === "all" ? "var(--indigo)" : "white", color: filter === "all" ? "white" : "var(--steel)", border: "1.5px solid var(--fog-dark)" }}>كل المخالفات ({list.length})</button>
      </div>

      {shown.length === 0 ? <p style={{ color: "var(--steel)" }}>لا توجد مخالفات {filter === "open" ? "بانتظار المراجعة" : "مسجّلة"}.</p> : (
        <div className="card" style={{ overflowX: "auto", marginBottom: 18 }}>
          <table className="data-table">
            <thead><tr><th>الوقت</th><th>المستخدم</th><th>السياق</th><th>الطالب</th><th>التصنيف / الألفاظ</th><th>النص</th><th>الحالة</th><th>المراجعة</th></tr></thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontSize: "0.78rem" }}>{fmtDT(v.occurred_at)}</td>
                  <td>{v.user_name ?? "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{CONTEXT_LABEL[v.context] ?? v.context}</td>
                  <td>{v.student_name ?? "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{v.categories.map((c) => CATEGORY_LABEL[c] ?? c).join("، ")}<div style={{ color: "var(--red)" }}>{v.matched_terms.join("، ")}</div></td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 300, whiteSpace: "pre-wrap" }}>{v.excerpt}</td>
                  <td style={{ fontSize: "0.8rem", fontWeight: 700, color: STATUS_COLOR[v.review_status] }}>
                    {STATUS_LABEL[v.review_status]}
                    {v.reviewed_by_name && <div style={{ fontWeight: 400, color: "var(--steel)" }}>{v.reviewed_by_name} · {v.reviewed_at ? fmtDT(v.reviewed_at) : ""}</div>}
                    {v.review_note && <div style={{ fontWeight: 400, color: "var(--steel)" }}>{v.review_note}</div>}
                  </td>
                  <td>
                    <input className="input" style={{ width: 150, marginBottom: 4 }} placeholder="ملاحظة" value={notes[v.id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [v.id]: e.target.value }))} />
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "2px 8px" }} onClick={() => review(v.id, "confirmed")}>تأكيد</button>
                      <button className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "2px 8px" }} onClick={() => review(v.id, "dismissed")}>رفض</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ padding: "1rem 1.1rem" }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>قاموس المدرسة الخاص</h3>
        <p style={{ fontSize: "0.8rem", color: "var(--steel)", marginTop: 0 }}>
          يُضاف إلى القاموس العام الذي تديره المنصة. «محجوب» = لفظ إضافي تريد منعه. «مسموح» = استثناء لكلمة بريئة تُحجب خطأً عندكم (مثل اسم علم)؛ الاستثناء يُزال من النص قبل الفحص.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={lbl}>المصطلح</label><input className="input" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} /></div>
          <div><label style={lbl}>النوع</label>
            <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value as "block" | "allow")}><option value="block">محجوب</option><option value="allow">مسموح (استثناء)</option></select></div>
          {newKind === "block" && (
            <div><label style={lbl}>التصنيف</label>
              <select className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          )}
          <button className="btn btn-gold" disabled={!newTerm.trim()} onClick={addTerm}>إضافة</button>
        </div>
        {terms.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {terms.map((t) => (
              <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--fog-dark)", borderRadius: 14, padding: "2px 10px", fontSize: "0.8rem", background: t.kind === "allow" ? "var(--fog)" : "white" }}>
                {t.term} <span style={{ color: "var(--steel)" }}>({t.kind === "allow" ? "مسموح" : CATEGORY_LABEL[t.category] ?? t.category})</span>
                <button onClick={() => removeTerm(t.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
