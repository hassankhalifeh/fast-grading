// تصدير CSV موحّد لكل شاشات التقارير (بادئة BOM حتى يفتح إكسل الملف بترميز عربي صحيح)
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
