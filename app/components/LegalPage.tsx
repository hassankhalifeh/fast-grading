import type { ReactNode } from "react";

// إطار مشترك لصفحتي الخصوصية والشروط (صفحات ثابتة بلا تسجيل دخول)
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "2rem 1.25rem", lineHeight: 1.9 }}>
      <a href="/" style={{ fontSize: "0.85rem" }}>← الصفحة الرئيسية</a>
      <h1 style={{ color: "var(--indigo)", margin: "12px 0 4px" }}>{title}</h1>
      <p style={{ color: "var(--steel)", fontSize: "0.82rem", marginTop: 0 }}>آخر تحديث: {updated}</p>
      <div className="grade-underline" style={{ margin: "8px 0 18px" }} />
      <div style={{ fontSize: "0.95rem" }}>{children}</div>
    </main>
  );
}

export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "عبر إدارة مدرستكم أو مشغّل المنصة";
