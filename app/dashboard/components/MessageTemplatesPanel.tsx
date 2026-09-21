"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser } from "@/lib/types";
import { MESSAGE_TYPES, defaultWaName, render, toMetaBody, validateBody, type MessageType } from "@/lib/messageTypes";
import { Save, RotateCcw } from "lucide-react";

interface Row { id: string; message_type: string; body_template: string; wa_template_name: string | null; wa_status: string; moderation_status: string }
const STATUS_LABEL: Record<string, string> = { none: "لم يُقدَّم", submitted: "قُدِّم — بانتظار الاعتماد", approved: "معتمد من واتساب", rejected: "مرفوض" };
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;
const SAMPLE: Record<string, string> = {
  الولي: "أم أحمد", الطالب: "أحمد خليل", المادة: "الرياضيات", الامتحان: "اختبار الفصل الأول", العلامة: "85", الحد: "100", الصف: "الصف الثامن أ",
  المدرسة: "مدرستكم", الفصل: "الأول", المعدل: "82.5", الترتيب: "3", عدد_الطلاب: "28", المواد: "الرياضيات والعلوم", الموعد: "الاثنين 15/9", النتيجة: "مُرفَّع",
};

// قوالب الرسائل: لكل مدرسة صياغتها الخاصة لكل نوع مراسلة. ما لم تُعدَّل تُستعمل الصياغة الافتراضية.
export default function MessageTemplatesPanel({ accountId, appUser }: { accountId: string; appUser: AppUser }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [t, a] = await Promise.all([
      supabase.from("notification_templates").select("id, message_type, body_template, wa_template_name, wa_status, moderation_status").eq("account_id", accountId).neq("message_type", "custom"),
      supabase.from("accounts").select("display_name").eq("id", accountId).maybeSingle(),
    ]);
    setRows((t.data ?? []) as Row[]);
    setSchoolName(a.data?.display_name ?? "");
  }
  useEffect(() => { load(); }, [accountId]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--steel)" }}>
        اكتب لكل نوع مراسلة الصياغة التي تناسب مدرستك. كل رسالة تمر على المراجعة والاعتماد قبل إرسالها، ويمكن تعديل نصها لطالب معيّن استثنائياً عند المراجعة.
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {message && <p style={{ color: "var(--green)" }}>{message}</p>}
      {MESSAGE_TYPES.map((t) => (
        <TypeCard key={t.key} type={t} row={rows.find((r) => r.message_type === t.key) ?? null} accountId={accountId} appUser={appUser} schoolName={schoolName}
          onDone={(m, err) => { setMessage(err ? null : m); setError(err); load(); }} />
      ))}
    </div>
  );
}

function TypeCard({ type, row, accountId, appUser, schoolName, onDone }: {
  type: MessageType; row: Row | null; accountId: string; appUser: AppUser; schoolName: string; onDone: (msg: string, err: string | null) => void;
}) {
  const [body, setBody] = useState(row?.body_template ?? type.body);
  const [waName, setWaName] = useState(row?.wa_template_name ?? defaultWaName(type.key));
  const [waStatus, setWaStatus] = useState(row?.wa_status ?? "none");
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<{ term: string; category: string }[]>([]);

  // فحص فوري أثناء الكتابة (بلا تسجيل)؛ الحجب الفعلي والتسجيل عند الحفظ
  useEffect(() => {
    const h = setTimeout(() => { supabase.rpc("moderation_check", { p_text: body }).then(({ data }) => setFlags((data as any) ?? [])); }, 500);
    return () => clearTimeout(h);
  }, [body]);

  useEffect(() => {
    setBody(row?.body_template ?? type.body);
    setWaName(row?.wa_template_name ?? defaultWaName(type.key));
    setWaStatus(row?.wa_status ?? "none");
  }, [row?.id, row?.body_template, row?.wa_template_name, row?.wa_status]);

  const warnings = validateBody(body, type.tokens);
  const customized = !!row;
  const dirty = body !== (row?.body_template ?? type.body) || waName !== (row?.wa_template_name ?? defaultWaName(type.key)) || waStatus !== (row?.wa_status ?? "none");

  async function save() {
    if (warnings.some((w) => w.startsWith("النص فارغ") || w.startsWith("متغيرات غير معروفة"))) return onDone("", warnings[0]);
    const name = waName.trim().toLowerCase();
    if (name && !/^[a-z0-9_]{1,512}$/.test(name)) return onDone("", "اسم القالب في واتساب: حروف إنكليزية صغيرة وأرقام و_ فقط");
    const payload = { body_template: body, wa_template_name: name || null, wa_status: waStatus, updated_by: appUser.id };
    const res = row
      ? await supabase.from("notification_templates").update(payload).eq("id", row.id)
      : await supabase.from("notification_templates").insert({ ...payload, account_id: accountId, message_type: type.key, name: type.label, created_by: appUser.id });
    if (res.error) return onDone("", res.error.message.includes("row-level security") ? "ليس لديك صلاحية تعديل القوالب" : res.error.message);
    // قراءة حالة الحجب بعد الحفظ (المُشغّل في قاعدة البيانات هو المرجع)
    const chk = await supabase.from("notification_templates").select("moderation_status").eq("account_id", accountId).eq("message_type", type.key).maybeSingle();
    if (chk.data?.moderation_status === "blocked") return onDone("", `رُفضت الصياغة لاحتوائها ألفاظاً غير لائقة وسُجّلت مخالفة للمراجعة. تُستعمل الصياغة الافتراضية حتى تُصحَّح.`);
    onDone(`حُفظت صياغة «${type.label}»`, null);
  }
  async function reset() {
    if (!row) return;
    const { error } = await supabase.from("notification_templates").delete().eq("id", row.id);
    onDone(error ? "" : `أُعيدت الصياغة الافتراضية لـ«${type.label}»`, error?.message ?? null);
  }

  const sample = { ...SAMPLE, المدرسة: schoolName || SAMPLE.المدرسة };
  return (
    <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <b>{type.label}</b> <span style={{ fontSize: "0.78rem", color: row?.moderation_status === "blocked" ? "var(--red)" : customized ? "var(--green)" : "var(--steel)" }}>{row?.moderation_status === "blocked" ? "⛔ محجوبة (ألفاظ غير لائقة) — تُستعمل الافتراضية" : customized ? "صياغة المدرسة" : "الصياغة الافتراضية"}</span>
          <div style={{ fontSize: "0.78rem", color: "var(--steel)" }}>{type.hint}</div>
        </div>
      </div>

      <textarea className="input" rows={5} style={{ width: "100%", maxWidth: 640, marginTop: 8 }} value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ fontSize: "0.78rem", color: "var(--steel)", margin: "4px 0 6px" }}>
        المتغيرات: {type.tokens.map((k) => (
          <button key={k} className="btn btn-secondary" style={{ fontSize: "0.72rem", padding: "1px 6px", marginInlineEnd: 4 }} onClick={() => setBody((b) => b + `{${k}}`)}>{`{${k}}`}</button>
        ))}
      </div>
      {flags.length > 0 && <p style={{ margin: "4px 0", fontSize: "0.82rem", color: "var(--red)", fontWeight: 700 }}>⛔ النص يحوي ألفاظاً غير لائقة ({flags.map((f) => f.term).join("، ")}): سيُحجب وتُسجَّل مخالفة عند الحفظ.</p>}
      {warnings.length > 0 && <ul style={{ margin: "4px 0", paddingInlineStart: 18, fontSize: "0.8rem", color: "var(--gold-dark)" }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <div style={{ background: "var(--fog)", borderRadius: 8, padding: "8px 12px", fontSize: "0.85rem", whiteSpace: "pre-wrap", maxWidth: 640 }}>
        <div style={{ fontSize: "0.72rem", color: "var(--steel)", marginBottom: 2 }}>معاينة بقيم تجريبية</div>
        {render(body, sample)}
      </div>

      <div style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" style={{ fontSize: "0.78rem" }} onClick={() => setOpen((o) => !o)}>{open ? "إخفاء" : "إعدادات واتساب الرسمي (للإرسال التلقائي)"}</button>
        {open && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><label style={lbl}>اسم القالب عند Meta</label>
                <input className="input" dir="ltr" style={{ width: 240 }} value={waName} onChange={(e) => setWaName(e.target.value)} /></div>
              <div><label style={lbl}>حالة الاعتماد</label>
                <select className="input" value={waStatus} onChange={(e) => setWaStatus(e.target.value)}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--steel)", margin: "6px 0" }}>
              الإرسال التلقائي يتطلب نصاً معتمداً من واتساب. عند تعديل الصياغة تُصفَّر الحالة ويلزم تقديمها من جديد. قدّم هذا النص حرفياً (الفئة Utility، اللغة العربية):
            </p>
            <pre dir="rtl" style={{ background: "var(--fog)", padding: "8px 12px", borderRadius: 8, fontSize: "0.82rem", whiteSpace: "pre-wrap", maxWidth: 640 }}>{toMetaBody(body)}</pre>
            <p style={{ fontSize: "0.78rem", color: "var(--steel)", margin: 0 }}>إن لم يُعتمد بعد يُرسل هذا النوع بفتح واتساب يدوياً برسالة جاهزة.</p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-gold" disabled={!dirty} onClick={save}><Save size={14} /> حفظ</button>
        {customized && <button className="btn btn-secondary" onClick={reset}><RotateCcw size={14} /> استعادة الافتراضي</button>}
      </div>
    </div>
  );
}
