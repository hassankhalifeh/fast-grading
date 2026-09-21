"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { GraduationCap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // روابط الإيميل (استعادة كلمة السر / دعوة مستخدم) بتفتح جلسة مؤقتة: لازم المستخدم يحدد كلمة سر.
  // مستخدم مسجّل دخوله بشكل عادي بيروح مباشرة للداشبورد.
  useEffect(() => {
    let needsPassword = /type=(recovery|invite)/.test(window.location.hash);
    if (needsPassword) setRecoveryMode(true);

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { needsPassword = true; setRecoveryMode(true); }
      if (session?.user?.user_metadata?.needs_password) { needsPassword = true; setRecoveryMode(true); }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      if (session.user.user_metadata?.needs_password) { setRecoveryMode(true); return; }
      if (!needsPassword) router.replace("/dashboard");
    });

    return () => data.subscription.unsubscribe();
  }, [router]);

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError("كلمة المرور يجب ألا تقل عن 8 أحرف"); return; }
    if (newPassword !== confirmPassword) { setError("كلمتا المرور غير متطابقتين"); return; }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword, data: { needs_password: false } });
    if (updateError) { setError(updateError.message); setSubmitting(false); return; }
    router.push("/dashboard");
  }

  async function handleForgotPassword() {
    setError(null);
    setInfo(null);
    if (!email) { setError("اكتب بريدك الإلكتروني أولاً ثم اضغط \"نسيت كلمة المرور\""); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (resetError) setError(resetError.message);
    else setInfo("أُرسل رابط الاستعادة إلى بريدك الإلكتروني");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form onSubmit={recoveryMode ? handleSetNewPassword : handleLogin} className="card fade-in" style={{ padding: "2.25rem", width: 380, maxWidth: "90%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 42, height: 42, borderRadius: 11, background: "var(--indigo)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <GraduationCap size={22} color="var(--gold)" />
          </div>
          <h1 style={{ fontSize: "1.35rem", color: "var(--indigo)", margin: 0, fontWeight: 800 }}>Grading SaaS</h1>
        </div>
        <p style={{ fontSize: "0.88rem", color: "var(--steel)", marginBottom: 22 }}>
          {recoveryMode ? "تعيين كلمة مرور جديدة" : "تسجيل الدخول للوحة التحكم"}
        </p>

        {recoveryMode ? (
          <>
            <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>كلمة المرور الجديدة</label>
            <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="input" style={{ margin: "6px 0 16px" }} autoComplete="new-password" />

            <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>تأكيد كلمة المرور</label>
            <input type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className="input" style={{ margin: "6px 0 16px" }} autoComplete="new-password" />
          </>
        ) : (
          <>
            <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>البريد الإلكتروني</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="input" style={{ margin: "6px 0 16px" }} />

            <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>كلمة المرور</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="input" style={{ margin: "6px 0 16px" }} />
          </>
        )}

        {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}
        {info && <p style={{ color: "var(--green)", fontSize: "0.85rem", marginBottom: 12 }}>{info}</p>}

        <button type="submit" disabled={submitting} className="btn btn-gold" style={{ width: "100%" }}>
          {recoveryMode
            ? (submitting ? "جارٍ الحفظ..." : "حفظ كلمة المرور")
            : (submitting ? "جارٍ الدخول..." : "دخول")}
        </button>

        {!recoveryMode && (
          <button type="button" onClick={handleForgotPassword}
            style={{ background: "none", border: "none", color: "var(--steel)", cursor: "pointer", marginTop: 14, fontSize: "0.85rem", width: "100%" }}>
            نسيت كلمة المرور؟
          </button>
        )}
        <p style={{ textAlign: "center", marginTop: 16, marginBottom: 0, fontSize: "0.78rem", color: "var(--steel)" }}>
          <a href="/terms">شروط الاستخدام</a> · <a href="/privacy">سياسة الخصوصية</a>
        </p>
      </form>
    </main>
  );
}
