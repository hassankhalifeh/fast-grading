"use client";

import React, { useMemo, useState } from "react";
import { SafeBoundary } from "./SafeBoundary";
import TableToolbar, { TableToolbarLabels } from "./TableToolbar";
import { EMPTY_QUERY, TableColumn, TableQuery, GetText, defaultGetText, distinctValues, filterRows, isQueryActive } from "./query";

export interface TableKitOptions<T> {
  getText?: GetText<T>;                 // for columns whose visible text is derived (default: String(row[key]))
  labels?: Partial<TableToolbarLabels>; // UI text (Arabic by default)
  enabled?: boolean;                    // manual off switch
}

export interface TableKitResult<T> {
  rows: T[];                // the rows to render (all rows if the kit is off or failed)
  toolbar: React.ReactNode; // render above the table; null when disabled/failed
  active: boolean;          // a search/filter is applied
  total: number;
  clear: () => void;
}

// Global kill switch: NEXT_PUBLIC_DISABLE_TABLEKIT=1 switches every table back to plain.
function killed(): boolean {
  try {
    return typeof process !== "undefined" && process.env?.NEXT_PUBLIC_DISABLE_TABLEKIT === "1";
  } catch {
    return false;
  }
}

// Search + filter for any list of rows. Built to fail safe: every step falls back to the untouched
// rows, and the toolbar sits in an error boundary, so a bug here can never break a page.
export function useTableKit<T = any>(rows: T[], columns: TableColumn[], options: TableKitOptions<T> = {}): TableKitResult<T> {
  const [query, setQuery] = useState<TableQuery>(EMPTY_QUERY);
  const getText = options.getText ?? (defaultGetText as GetText<T>);
  const enabled = options.enabled !== false && !killed();

  const filtered = useMemo(() => {
    if (!enabled) return rows;
    try {
      return filterRows(rows, columns, query, getText);
    } catch {
      return rows;
    }
    // columns/getText are treated as stable definitions by callers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, enabled]);

  const distincts = useMemo(() => {
    const out: Record<string, string[] | null> = {};
    if (!enabled) return out;
    try {
      for (const c of columns) out[c.key] = distinctValues(rows, c.key, getText);
    } catch {
      /* no dropdowns */
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, enabled]);

  const active = enabled && isQueryActive(query);
  const toolbar =
    enabled && rows.length > 0 ? (
      <SafeBoundary fallback={null}>
        <TableToolbar columns={columns} query={query} onChange={setQuery} distincts={distincts} total={rows.length} shown={filtered.length} active={active} labels={options.labels} />
      </SafeBoundary>
    ) : null;

  return { rows: filtered, toolbar, active, total: rows.length, clear: () => setQuery(EMPTY_QUERY) };
}
