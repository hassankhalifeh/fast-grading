"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { GraduationCap, CheckCircle2 } from "lucide-react";

interface PublicPlan {
  key: string; name: string; description: string | null; account_type: "school_enterprise" | "solo_teacher" | null;
  class_limit: number; students_per_class: number; total_students: number; max_buildings: number; max_stages: number;
  features: string[]; duration_days: number | null;
}

const FEATURE_LABEL: Record<string, string> = { whatsapp_notifications: "مراسلات أولياء الأمور عبر واتساب" };
const lbl: React.CSSProperties = { display: "block", fontSize: "0.85rem", color: "#333", fontWeight: 600, marginBottom: 6 };

// صفحة عامة (بلا تسجيل دخول): طلب فتح حساب. الطلب يصل إلى مالك المنصة ليعتمده أو يرفضه؛ لا يُنشأ حساب تلقائياً ولا يوجد دفع.
export default function ApplyPage() {
  const [type, setType] = useState<"school_enterprise" | "solo_teacher">("school_enterprise");
  const [org, setOrg] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [students, setStudents] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");   // مصيدة الروبوتات: مخفي عن البشر
  const [agree, setAgree] = useState(false);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.rpc("list_public_plans").then(({ data }) => setPlans((data ?? []) as PublicPlan[]));
  }, []);
  useEffect(() => { setPlanKey(""); }, [type]);

  const shownPlans = plans.filter((p) => !p.account_type || p.account_type === type);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agree) return setError("وافق على شروط الاستخدام وسياسة الخصوصية أولاً");
    setBusy(true);
    const { error: err } = await supabase.rpc("submit_account_application", {
      p_account_type: type, p_org_name: org, p_contact_name: contact, p_email: email, p_phone: phone || null, p_country: country || null,
      p_plan_key: planKey || null, p_student_count: students ? Number(students) : null, p_message: message || null, p_website: website,
    });
    setBusy(false);
    if (err) return setError(err.message);
    setDone(true);
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "2rem 1rem" }}>
      <div className="card fade-in" style={{ padding: "2rem", width: 620, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: "var(--indigo)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <GraduationCap size={22} color="var(--gold)" />
          </div>
          <h1 style={{ fontSize: "1.35rem", color: "var(--indigo)", margin: 0, fontWeight: 800 }}>طلب فتح حساب</h1>
        </div>

        {done ? (
          <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
            <CheckCircle2 size={44} color="var(--green)" />
            <p style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--indigo)", margin: "12px 0 6px" }}>وصلنا طلبك</p>
            <p style={{ color: "var(--steel)", fontSize: "0.9rem", lineHeight: 1.9, margin: "0 0 16px" }}>
              سنراجعه ونتواصل معك على البريد الذي كتبته. عند الموافقة تصلك دعوة لتعيين كلمة المرور.
            </p>
            <a href="/">العودة إلى تسجيل الدخول</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p style={{ fontSize: "0.88rem", color: "var(--steel)", marginBottom: 20 }}>
              املأ البيانات التالية وسنراجع طلبك ونتواصل معك. لا يُنشأ الحساب تلقائياً ولا يوجد دفع في هذه الخطوة.
            </p>

            <label style={lbl}>نوع الحساب</label>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              {([["school_enterprise", "مدرسة"], ["solo_teacher", "معلّم مستقل"]] as const).map(([v, t]) => (
                <label key={v} className="card" style={{ padding: "8px 16px", cursor: "pointer", border: type === v ? "2px solid var(--gold)" : "2px solid transparent", fontSize: "0.9rem" }}>
                  <input type="radio" name="type" checked={type === v} onChange={() => setType(v)} style={{ marginInlineEnd: 8 }} />{t}
                </label>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <div><label style={lbl}>{type === "solo_teacher" ? "اسم الحساب" : "اسم المدرسة"} *</label>
                <input className="input" required minLength={2} maxLength={120} value={org} onChange={(e) => setOrg(e.target.value)} /></div>
              <div><label style={lbl}>{type === "solo_teacher" ? "اسمك" : "اسم المسؤول (مدير المدرسة)"} *</label>
                <input className="input" required minLength={2} maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} /></div>
              <div><label style={lbl}>البريد الإلكتروني * (تصله دعوة التفعيل)</label>
                <input className="input" type="email" required dir="ltr" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><label style={lbl}>الهاتف (اختياري)</label>
                <input className="input" dir="ltr" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><label style={lbl}>الدولة (اختياري)</label>
                <input className="input" maxLength={60} value={country} onChange={(e) => setCountry(e.target.value)} /></div>
              <div><label style={lbl}>عدد الطلاب التقريبي (اختياري)</label>
                <input className="input" type="number" min={0} max={1000000} value={students} onChange={(e) => setStudents(e.target.value)} /></div>
            </div>

            {shownPlans.length > 0 && (
              <>
                <label style={{ ...lbl, marginTop: 18 }}>الباقة المرغوبة (اختياري)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label className="card" style={{ padding: "10px 14px", cursor: "pointer", border: planKey === "" ? "2px solid var(--gold)" : "2px solid transparent", fontSize: "0.88rem" }}>
                    <input type="radio" name="plan" checked={planKey === ""} onChange={() => setPlanKey("")} style={{ marginInlineEnd: 8 }} />لا أعرف بعد، اقترحوا لي
                  </label>
                  {shownPlans.map((p) => (
                    <label key={p.key} className="card" style={{ padding: "10px 14px", cursor: "pointer", border: planKey === p.key ? "2px solid var(--gold)" : "2px solid transparent", fontSize: "0.88rem" }}>
                      <input type="radio" name="plan" checked={planKey === p.key} onChange={() => setPlanKey(p.key)} style={{ marginInlineEnd: 8 }} />
                      <b>{p.name}</b>
                      {p.description && <span style={{ color: "var(--steel)" }}> — {p.description}</span>}
                      <div style={{ fontSize: "0.78rem", color: "var(--steel)", marginTop: 4, marginInlineStart: 24 }}>
                        حتى {p.class_limit} صفاً و{p.total_students} طالباً
                        {p.features.length > 0 && <> · {p.features.map((f) => FEATURE_LABEL[f] ?? f).join("، ")}</>}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            <label style={{ ...lbl, marginTop: 18 }}>ملاحظات (اختياري)</label>
            <textarea className="input" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} style={{ resize: "vertical" }} />

            {/* مصيدة الروبوتات: حقل لا يراه المستخدم ولا يصله بلوحة المفاتيح */}
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)}
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.82rem", color: "var(--steel)", margin: "16px 0" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
              <span>أوافق على <a href="/terms" target="_blank">شروط الاستخدام</a> و<a href="/privacy" target="_blank">سياسة الخصوصية</a> وعلى التواصل معي بخصوص هذا الطلب.</span>
            </label>

            {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}
            <button type="submit" disabled={busy} className="btn btn-gold" style={{ width: "100%" }}>{busy ? "جارٍ الإرسال..." : "إرسال الطلب"}</button>
            <p style={{ textAlign: "center", marginTop: 16, marginBottom: 0, fontSize: "0.82rem" }}><a href="/">لديك حساب؟ تسجيل الدخول</a></p>
          </form>
        )}
      </div>
    </main>
  );
}
