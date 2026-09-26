// Pure search/filter logic. No React, no app imports — safe to copy into any project.

export interface TableColumn { key: string; label: string }

export interface TableQuery {
  global: string;                    // searched across every column
  columns: Record<string, string>;   // per-column "contains" search
  filters: Record<string, string>;   // per-column exact-value filter ("" = no filter)
}

export const EMPTY_QUERY: TableQuery = { global: "", columns: {}, filters: {} };

export type GetText<T> = (row: T, key: string) => string;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// Arabic-friendly comparison: ignores diacritics/tatweel, unifies alef/ya/ta-marbuta forms and digit sets.
export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export function defaultGetText(row: any, key: string): string {
  const v = row?.[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return ""; }
  }
  return String(v);
}

export function isQueryActive(q: TableQuery): boolean {
  return (
    q.global.trim() !== "" ||
    Object.values(q.columns).some((v) => v.trim() !== "") ||
    Object.values(q.filters).some((v) => v !== "")
  );
}

export function filterRows<T>(rows: T[], columns: TableColumn[], q: TableQuery, getText: GetText<T> = defaultGetText): T[] {
  if (!isQueryActive(q)) return rows;

  const terms = normalizeText(q.global).split(" ").filter(Boolean);
  const colSearch = Object.entries(q.columns)
    .map(([k, v]) => [k, normalizeText(v)] as const)
    .filter(([, v]) => v !== "");
  const colFilter = Object.entries(q.filters).filter(([, v]) => v !== "");

  return rows.filter((row) => {
    for (const [key, wanted] of colFilter) {
      if (getText(row, key).trim() !== wanted) return false;
    }
    for (const [key, needle] of colSearch) {
      if (!normalizeText(getText(row, key)).includes(needle)) return false;
    }
    if (terms.length > 0) {
      const haystack = normalizeText(columns.map((c) => getText(row, c.key)).join(" "));
      for (const t of terms) if (!haystack.includes(t)) return false;
    }
    return true;
  });
}

// Distinct values of a column for a filter dropdown; null when there are too many to be useful.
export function distinctValues<T>(rows: T[], key: string, getText: GetText<T> = defaultGetText, limit = 40): string[] | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = getText(r, key).trim();
    if (v === "") continue;
    seen.add(v);
    if (seen.size > limit) return null;
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, "ar"));
}
