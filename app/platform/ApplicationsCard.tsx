"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Application {
  id: string; account_type: "school_enterprise" | "solo_teacher"; org_name: string; contact_name: string; email: string; phone: string | null;
  country: string | null; plan_key: string | null; student_count: number | null; message: string | null;
  status: "pending" | "approved" | "rejected"; email_registered: boolean; decision_note: string | null; decided_at: string | null; created_at: string;
}

const TYPE_LABEL = { school_enterprise: "مدرسة", solo_teacher: "معلّم مستقل" } as const;
const STATUS_LABEL = { pending: "بانتظار القرار", approved: "اعتُمد", rejected: "رُفض" } as const;

// طلبات فتح الحساب القادمة من الصفحة العامة /apply. الاعتماد يملأ نموذج «إنشاء حساب جديد» بالبيانات (وتبقى قابلة للتعديل)،
// ويُعلَّم الطلب معتمداً تلقائياً بعد نجاح الإنشاء. الرفض يحفظ ملاحظة اختيارية. RLS يحصر الجدول بمالك المنصة.
export default function ApplicationsCard({ reloadKey, planName, onApprove, onCount }: {
  reloadKey: number; planName: (key: string | null | undefined) => string; onApprove: (a: Application) => void; onCount?: (pending: number) => void;
}) {
  const [rows, setRows] = useState<Application[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("account_applications").select("*").order("created_at", { ascending: false }).limit(200);
    const list = (data ?? []) as Application[];
    setRows(list);
    onCount?.(list.filter((r) => r.status === "pending").length);
  }
  useEffect(() => { load(); }, [reloadKey]);

  async function reject(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("account_applications")
      .update({ status: "rejected", decision_note: note.trim() || null, decided_at: new Date().toISOString() }).eq("id", id);
    setBusy(false);
    if (error) return setErr(error.message);
    setRejecting(null); setNote(""); load();
  }

  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  return (
    <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 18, borderInlineStart: pending.length ? "4px solid var(--gold)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>طلبات فتح الحساب {pending.length > 0 && <span style={{ background: "var(--red)", color: "white", borderRadius: 9, padding: "1px 8px", fontSize: "0.75rem", marginInlineStart: 6 }}>{pending.length}</span>}</h3>
        <span style={{ marginInlineStart: "auto", fontSize: "0.78rem", color: "var(--steel)" }}>الرابط العام: <a href="/apply" target="_blank" dir="ltr">/apply</a></span>
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>{err}</p>}

      {pending.length === 0 ? <p style={{ margin: "4px 0", color: "var(--steel)", fontSize: "0.88rem" }}>لا طلبات بانتظار القرار.</p> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pending.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--fog-dark)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <b>{a.org_name}</b><span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>{TYPE_LABEL[a.account_type]}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--steel-light)", marginInlineStart: "auto" }}>{new Date(a.created_at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <div style={{ fontSize: "0.85rem", margin: "4px 0", lineHeight: 1.9 }}>
                {a.contact_name} · <span dir="ltr">{a.email}</span>{a.phone && <> · <span dir="ltr">{a.phone}</span></>}{a.country && <> · {a.country}</>}
                <br />الباقة المرغوبة: <b>{a.plan_key ? planName(a.plan_key) : "لم يحدّد"}</b>{a.student_count !== null && <> · عدد الطلاب التقريبي: <b>{a.student_count}</b></>}
                {a.email_registered && <><br /><b style={{ color: "var(--red)" }}>تنبيه: هذا البريد مسجَّل مسبقاً في النظام</b></>}
                {a.message && <><br /><span style={{ color: "var(--steel)" }}>«{a.message}»</span></>}
              </div>
              {rejecting === a.id ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" style={{ maxWidth: 320 }} maxLength={500} placeholder="سبب الرفض (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn btn-secondary" disabled={busy} onClick={() => reject(a.id)}>تأكيد الرفض</button>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => { setRejecting(null); setNote(""); }}>إلغاء</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-gold" disabled={a.email_registered} title={a.email_registered ? "البريد مسجَّل مسبقاً، لا يمكن إنشاء حساب جديد به" : undefined} onClick={() => onApprove(a)}>اعتماد وإنشاء حساب</button>
                  <button className="btn btn-secondary" onClick={() => { setRejecting(a.id); setNote(""); }}>رفض</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setShowAll((s) => !s)} style={{ background: "none", border: "none", color: "var(--indigo)", cursor: "pointer", fontSize: "0.82rem", padding: 0 }}>
            {showAll ? "إخفاء السجل" : `عرض السجل (${history.length})`}
          </button>
          {showAll && (
            <table className="data-table" style={{ fontSize: "0.8rem", marginTop: 6 }}>
              <thead><tr><th>الجهة</th><th>النوع</th><th>البريد</th><th>الحالة</th><th>ملاحظة</th><th>التاريخ</th></tr></thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>{a.org_name}</td><td>{TYPE_LABEL[a.account_type]}</td><td dir="ltr">{a.email}</td>
                    <td style={{ color: a.status === "approved" ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{STATUS_LABEL[a.status]}</td>
                    <td>{a.decision_note ?? ""}</td>
                    <td>{new Date(a.decided_at ?? a.created_at).toLocaleDateString("ar")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
