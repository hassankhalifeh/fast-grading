"use client";

import { useTableKit } from "@/lib/tablekit";

export interface Column {
  key: string;
  label: string;
}

const visible = (row: Record<string, any>, key: string) => String(row[key] ?? "—");

// الجدول المشترك لأغلب القوائم والتقارير: يحمل بحثاً وفلترة (tablekit) تلقائياً لكل جدول يستعمله.
export default function SimpleTable({ columns, rows }: { columns: Column[]; rows: Record<string, any>[] }) {
  const tk = useTableKit(rows, columns, { getText: visible });

  if (rows.length === 0) {
    return <p style={{ color: "var(--steel)", fontSize: "0.95rem" }}>لا توجد سجلات بعد.</p>;
  }

  return (
    <>
      {tk.toolbar}
      <div className="card fade-in" style={{ overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {tk.rows.map((row, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key}>{visible(row, c.key)}</td>)}</tr>
            ))}
            {tk.active && tk.rows.length === 0 && (
              <tr><td colSpan={columns.length} style={{ textAlign: "center", color: "var(--steel)" }}>لا نتائج مطابقة للبحث.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
