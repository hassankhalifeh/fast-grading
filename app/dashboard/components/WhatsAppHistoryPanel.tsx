"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Msg {
  id: string; direction: "in" | "out"; channel_mode: "api" | "manual" | "inbound"; our_phone_number_id: string | null; our_display_phone: string | null;
  contact_phone: string; student_name: string | null; msg_type: string; body: string | null; status: string | null; error_text: string | null; occurred_at: string;
}
interface NumRow { id: string; phone_number_id: string; display_phone: string | null; verified_name: string | null; active_from: string; active_to: string | null }

const MODE: Record<string, string> = { api: "تلقائي", manual: "يدوي (فتح واتساب)", inbound: "وارد" };
const STATUS: Record<string, string> = { sent: "أُرسلت", accepted: "قُبلت لدى واتساب", delivered: "سُلّمت", read: "قُرئت", failed: "فشلت", received: "" };
const fmtDT = (s: string) => new Date(s).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });

function downloadCsv(rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  a.download = "whatsapp-log.csv"; a.click(); URL.revokeObjectURL(a.href);
}

// سجل محادثات واتساب الدائم: كل رسالة صادرة/واردة مع الرقم الذي استُعمل وقتها. لا تُحذف ولا تتغير حتى لو غيّرت المدرسة رقمها.
export default function WhatsAppHistoryPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [nums, setNums] = useState<NumRow[]>([]);
  const [numFilter, setNumFilter] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("whatsapp_messages").select("id, direction, channel_mode, our_phone_number_id, our_display_phone, contact_phone, student_name, msg_type, body, status, error_text, occurred_at").order("occurred_at", { ascending: false }).limit(3000),
      supabase.from("whatsapp_number_history").select("*").order("active_from", { ascending: false }),
    ]).then(([m, n]) => {
      if (m.error) setError(m.error.message.includes("permission") || m.error.message.includes("row-level") ? "ليس لديك صلاحية عرض السجل" : m.error.message);
      setMsgs((m.data ?? []) as Msg[]); setNums((n.data ?? []) as NumRow[]); setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => msgs.filter((m) => {
    if (numFilter && (m.our_phone_number_id ?? "") !== numFilter) return false;
    if (q) { const t = q.trim(); if (!(m.contact_phone.includes(t) || (m.student_name ?? "").includes(t) || (m.body ?? "").includes(t))) return false; }
    return true;
  }), [msgs, numFilter, q]);

  const threads = useMemo(() => {
    const map = new Map<string, Msg[]>();
    filtered.forEach((m) => map.set(m.contact_phone, [...(map.get(m.contact_phone) ?? []), m]));
    return [...map.entries()].map(([phone, list]) => ({ phone, list: list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)) }))
      .sort((a, b) => b.list[b.list.length - 1].occurred_at.localeCompare(a.list[a.list.length - 1].occurred_at));
  }, [filtered]);
  const current = threads.find((t) => t.phone === sel) ?? null;
  const nameFor = (list: Msg[]) => list.find((m) => m.student_name)?.student_name;

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 0 }}>
        سجل دائم لكل رسالة صادرة أو واردة، مع الرقم الذي استُعمل وقتها. <b>لا تُحذف الرسائل ولا تتغير</b> حتى لو غيّرت المدرسة رقم واتساب لاحقاً؛ يبقى كل شيء منسوباً للرقم الذي جرى عليه.
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}

      <div className="card" style={{ overflowX: "auto", marginBottom: 14 }}>
        <table className="data-table">
          <thead><tr><th>رقم واتساب المدرسة</th><th>الاسم المعتمد</th><th>من</th><th>إلى</th></tr></thead>
          <tbody>
            {nums.length === 0 && <tr><td colSpan={4} style={{ color: "var(--steel)" }}>لا أرقام مسجّلة بعد (تُسجَّل عند حفظ بيانات الاتصال).</td></tr>}
            {nums.map((n) => (
              <tr key={n.id}>
                <td dir="ltr" style={{ textAlign: "right" }}>{n.display_phone ?? n.phone_number_id}</td><td>{n.verified_name ?? "—"}</td>
                <td>{fmtDT(n.active_from)}</td><td style={{ color: n.active_to ? "var(--steel)" : "var(--green)", fontWeight: n.active_to ? 400 : 700 }}>{n.active_to ? fmtDT(n.active_to) : "الرقم الحالي"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <div><label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>الرقم</label>
          <select className="input" value={numFilter} onChange={(e) => setNumFilter(e.target.value)}>
            <option value="">كل الأرقام</option>
            {nums.map((n) => <option key={n.id} value={n.phone_number_id}>{n.display_phone ?? n.phone_number_id}{n.active_to ? " (سابق)" : " (حالي)"}</option>)}
          </select></div>
        <div><label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>بحث (رقم / طالب / نص)</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {filtered.length > 0 && (
          <button className="btn btn-secondary" onClick={() => downloadCsv([
            ["الوقت", "الاتجاه", "الطريقة", "رقم المدرسة", "الطرف الآخر", "الطالب", "النص", "الحالة"],
            ...filtered.slice().reverse().map((m) => [m.occurred_at, m.direction === "out" ? "صادر" : "وارد", MODE[m.channel_mode], m.our_display_phone ?? m.our_phone_number_id ?? "", m.contact_phone, m.student_name ?? "", m.body ?? "", m.status ?? ""]),
          ])}>تصدير CSV</button>
        )}
      </div>

      {loading ? <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p> : threads.length === 0 ? <p style={{ color: "var(--steel)" }}>لا توجد رسائل مسجّلة.</p> : (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="card" style={{ width: 300, maxHeight: 520, overflowY: "auto", flexShrink: 0 }}>
            {threads.map((t) => {
              const last = t.list[t.list.length - 1];
              return (
                <button key={t.phone} onClick={() => setSel(t.phone)} style={{
                  display: "block", width: "100%", textAlign: "start", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--fog-dark)", cursor: "pointer",
                  background: sel === t.phone ? "var(--fog)" : "white",
                }}>
                  <b>{nameFor(t.list) ?? <span dir="ltr">+{t.phone}</span>}</b>
                  {nameFor(t.list) && <span dir="ltr" style={{ fontSize: "0.75rem", color: "var(--steel)" }}> +{t.phone}</span>}
                  <div style={{ fontSize: "0.78rem", color: "var(--steel)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last.direction === "in" ? "↩ " : ""}{last.body}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--steel)" }}>{t.list.length} رسالة · {fmtDT(last.occurred_at)}</div>
                </button>
              );
            })}
          </div>
          <div className="card" style={{ flex: 1, minWidth: 320, padding: "0.9rem 1rem", maxHeight: 520, overflowY: "auto" }}>
            {!current ? <p style={{ color: "var(--steel)" }}>اختر محادثة من القائمة.</p> : current.list.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.direction === "out" ? "flex-start" : "flex-end", marginBottom: 10 }}>
                <div style={{ maxWidth: "80%", background: m.direction === "out" ? "var(--fog)" : "white", border: "1px solid var(--fog-dark)", borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem" }}>{m.body}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--steel)", marginTop: 4 }}>
                    {fmtDT(m.occurred_at)} · {MODE[m.channel_mode]}{m.our_display_phone ? <> · {m.direction === "out" ? "من" : "إلى"} <span dir="ltr">{m.our_display_phone}</span></> : ""}
                    {m.direction === "out" && m.status && ` · ${STATUS[m.status] ?? m.status}`}
                  </div>
                  {m.error_text && <div style={{ fontSize: "0.72rem", color: "var(--red)" }}>{m.error_text}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
