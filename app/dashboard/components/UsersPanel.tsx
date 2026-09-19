"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { AppUser, UserRole } from "@/lib/types";

interface Row {
  id: string; full_name: string; email: string | null; phone: string | null; role: UserRole;
  is_active: boolean; accepted: boolean; last_sign_in_at: string | null;
}

const ROLE_LABEL: Record<UserRole, string> = {
  solo_teacher: "معلم مستقل", school_admin: "الناظر العام", assistant_admin: "مساعد ناظر",
  subject_teacher: "معلم مادة", custom_role: "دور مخصص",
};
const RANK: Record<UserRole, number> = { solo_teacher: 4, school_admin: 3, assistant_admin: 2, subject_teacher: 1, custom_role: 1 };
const INVITABLE: UserRole[] = ["school_admin", "assistant_admin", "subject_teacher", "custom_role"];

const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// الدعوة: رتبة المدعو أدنى من رتبتك، ولا يجوز ناظران عامان. الدعوة نفسها تتم عبر Edge Function (تحتاج service role).
export default function UsersPanel({ appUser }: { appUser: AppUser }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("subject_teacher");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data, error: err } = await supabase.rpc("list_account_users");
    if (err) return setError(err.message);
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => { load(); }, []);

  const fail = (m: string) => { setMessage(null); setError(m); };
  const ok = (m: string) => { setError(null); setMessage(m); };

  const hasPrincipal = rows.some((r) => r.role === "school_admin" && r.is_active);
  const roleOptions = INVITABLE.filter((r) => RANK[r] < RANK[appUser.role] && !(r === "school_admin" && hasPrincipal));

  useEffect(() => {
    if (roleOptions.length && !roleOptions.includes(role)) setRole(roleOptions[roleOptions.length - 1]);
  }, [rows]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !fullName) return fail("اكتب الاسم والبريد الإلكتروني");
    setSending(true);
    const { data, error: err } = await supabase.functions.invoke("invite-user", {
      body: { email, full_name: fullName, phone: phone || null, role, redirect_to: window.location.origin },
    });
    setSending(false);
    if (err) {
      let msg = err.message;
      try { const body = await (err as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep default */ }
      return fail(msg);
    }
    if (data?.error) return fail(data.error);
    setEmail(""); setFullName(""); setPhone("");
    ok(data?.message ?? "أُرسلت الدعوة");
    load();
  }

  async function toggleActive(r: Row) {
    const { data, error: err } = await supabase.rpc("set_user_active", { p_user: r.id, p_active: !r.is_active });
    if (err) return fail(err.message);
    ok(String(data));
    load();
  }

  async function resend(r: Row) {
    if (!r.email) return fail("لا يوجد بريد إلكتروني لهذا المستخدم");
    const { error: err } = await supabase.auth.resetPasswordForEmail(r.email, { redirectTo: window.location.origin });
    if (err) return fail(err.message);
    ok("أُعيد إرسال رابط تعيين كلمة المرور إلى " + r.email);
  }

  const status = (r: Row) =>
    !r.is_active ? { text: "معطّل", color: "var(--red)" }
    : !r.accepted ? { text: "بانتظار قبول الدعوة", color: "var(--gold-dark)" }
    : { text: "نشط", color: "var(--green)" };

  return (
    <div className="fade-in">
      <p style={{ fontSize: "0.85rem", color: "var(--steel)", marginBottom: 12 }}>
        ادعُ مستخدماً بالبريد الإلكتروني وسيصله رابط يحدد فيه كلمة مروره. تُمنح له صلاحيات افتراضية حسب دوره، وتُعدَّل من قسم "الصلاحيات".
        رتبة المدعو لازم تكون أدنى من رتبتك، ولا يجوز وجود ناظرين عامين.
      </p>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 10 }}>{error}</p>}
      {message && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 10 }}>{message}</p>}

      <form onSubmit={invite} className="card" style={{ padding: "1.1rem", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={lbl}>الاسم</label><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
        <div><label style={lbl}>البريد الإلكتروني</label><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label style={lbl}>الهاتف (اختياري)</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label style={lbl}>الدور</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select></div>
        <button type="submit" disabled={sending || roleOptions.length === 0} className="btn btn-gold">{sending ? "جارٍ الإرسال..." : "إرسال الدعوة"}</button>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = status(r);
              const canEdit = r.id !== appUser.id && RANK[r.role] < RANK[appUser.role];
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 700 }}>{r.full_name}</td>
                  <td>{r.email ?? "—"}</td>
                  <td>{ROLE_LABEL[r.role]}</td>
                  <td style={{ color: st.color, fontWeight: 700 }}>{st.text}</td>
                  <td>{r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleDateString("ar") : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canEdit && !r.accepted && r.is_active && (
                      <button className="btn btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 10px", marginInlineEnd: 6 }} onClick={() => resend(r)}>إعادة إرسال</button>
                    )}
                    {canEdit && (
                      <button className="btn btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 10px" }} onClick={() => toggleActive(r)}>
                        {r.is_active ? "تعطيل" : "تفعيل"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
