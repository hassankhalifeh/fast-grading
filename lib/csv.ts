// قارئ CSV بسيط (فاصلة / فاصلة منقوطة / Tab، اقتباسات، BOM) - يكفي لملفات الطلاب/الصفوف/المعلمين
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const delim = [",", ";", "\t"]
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

// نفس فكرة normalize_ar بالقاعدة: توحيد الألف والتاء المربوطة والتشكيل لمطابقة أسماء الصفوف/المراحل
export function normalizeAr(s: string): string {
  return (s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// تخمين العمود من عنوانه
export function guessColumn(headers: string[], keywords: string[]): number {
  const norm = headers.map(normalizeAr);
  return norm.findIndex((h) => keywords.some((k) => h.includes(normalizeAr(k))));
}
