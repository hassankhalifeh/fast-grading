"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { GraduationCap } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      <form onSubmit={handleLogin} className="card fade-in" style={{ padding: "2.25rem", width: 380, maxWidth: "90%" }}>
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
        <p style={{ fontSize: "0.88rem", color: "var(--steel)", marginBottom: 22 }}>تسجيل الدخول للوحة التحكم</p>

        <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>البريد الإلكتروني</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="input" style={{ margin: "6px 0 16px" }} />

        <label style={{ fontSize: "0.85rem", color: "#333", fontWeight: 600 }}>كلمة المرور</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="input" style={{ margin: "6px 0 16px" }} />

        {error && <p style={{ color: "var(--red)", fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}

        <button type="submit" disabled={submitting} className="btn btn-gold" style={{ width: "100%" }}>
          {submitting ? "جارٍ الدخول..." : "دخول"}
        </button>
      </form>
    </main>
  );
}
