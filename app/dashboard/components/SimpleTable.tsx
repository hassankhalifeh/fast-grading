"use client";

export interface Column {
  key: string;
  label: string;
}

export default function SimpleTable({ columns, rows }: { columns: Column[]; rows: Record<string, any>[] }) {
  if (rows.length === 0) {
    return <p style={{ color: "var(--steel)", fontSize: "0.95rem" }}>لا توجد سجلات بعد.</p>;
  }

  return (
    <div className="card fade-in" style={{ overflow: "hidden" }}>
      <table className="data-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key}>{String(row[c.key] ?? "—")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
