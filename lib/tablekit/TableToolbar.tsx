"use client";

import React, { useState } from "react";
import type { TableColumn, TableQuery } from "./query";

export interface TableToolbarLabels {
  searchAll: string;
  advanced: string;
  clear: string;
  contains: string;
  all: string;
  results: (shown: number, total: number) => string;
}

export const DEFAULT_LABELS: TableToolbarLabels = {
  searchAll: "بحث في كل الأعمدة...",
  advanced: "بحث وفلترة حسب العمود",
  clear: "مسح الكل",
  contains: "يحتوي على...",
  all: "الكل",
  results: (shown, total) => `${shown} من ${total}`,
};

const box: React.CSSProperties = { border: "1.5px solid var(--fog-dark, #d5dbe0)", borderRadius: 8, padding: "7px 10px", fontSize: "0.86rem", fontFamily: "inherit", background: "white", minWidth: 0 };
const btn: React.CSSProperties = { border: "1.5px solid var(--fog-dark, #d5dbe0)", borderRadius: 8, padding: "7px 12px", fontSize: "0.84rem", fontFamily: "inherit", background: "white", cursor: "pointer" };

interface Props {
  columns: TableColumn[];
  query: TableQuery;
  onChange: (q: TableQuery) => void;
  distincts: Record<string, string[] | null>;
  total: number;
  shown: number;
  active: boolean;
  labels?: Partial<TableToolbarLabels>;
}

// Screen-only (class "no-print"): a printed table never carries the search controls.
export default function TableToolbar({ columns, query, onChange, distincts, total, shown, active, labels }: Props) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const [open, setOpen] = useState(false);
  const detailActive = Object.values(query.columns).some((v) => v.trim()) || Object.values(query.filters).some(Boolean);

  const setCol = (key: string, v: string) => onChange({ ...query, columns: { ...query.columns, [key]: v } });
  const setFilter = (key: string, v: string) => onChange({ ...query, filters: { ...query.filters, [key]: v } });

  return (
    <div className="no-print" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="search"
          value={query.global}
          onChange={(e) => onChange({ ...query, global: e.target.value })}
          placeholder={L.searchAll}
          aria-label={L.searchAll}
          style={{ ...box, flex: "1 1 240px", maxWidth: 420 }}
        />
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...btn, borderColor: detailActive ? "var(--navy, #1b2a38)" : undefined }}>
          {L.advanced} {open ? "▲" : "▼"}
        </button>
        {active && <button type="button" onClick={() => onChange({ global: "", columns: {}, filters: {} })} style={btn}>{L.clear}</button>}
        {active && <span style={{ fontSize: "0.82rem", color: "var(--steel, #6b7a86)" }}>{L.results(shown, total)}</span>}
      </div>

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginTop: 10, padding: 12, borderRadius: 10, background: "var(--fog, #f3f5f7)" }}>
          {columns.map((c) => {
            const values = distincts[c.key];
            return (
              <div key={c.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--steel, #6b7a86)" }}>{c.label}</span>
                <input
                  value={query.columns[c.key] ?? ""}
                  onChange={(e) => setCol(c.key, e.target.value)}
                  placeholder={L.contains}
                  aria-label={`${c.label}: ${L.contains}`}
                  style={box}
                />
                {values && values.length > 1 && (
                  <select value={query.filters[c.key] ?? ""} onChange={(e) => setFilter(c.key, e.target.value)} aria-label={`${c.label}: ${L.all}`} style={box}>
                    <option value="">{L.all}</option>
                    {values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
