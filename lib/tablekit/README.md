# tablekit — search & filter for any table (plug-in module)

Self-contained: depends only on React. Copy this whole folder into another project (e.g. `lib/tablekit`)
and use it as below. It fails safe — a bug inside never breaks the host page (it falls back to the plain rows).

## Use

```tsx
import { useTableKit } from "@/lib/tablekit";

const columns = [{ key: "full_name", label: "الاسم" }, { key: "phone", label: "الهاتف" }];
const tk = useTableKit(rows, columns);   // tk.rows = filtered rows, tk.toolbar = the search UI

return (
  <>
    {tk.toolbar}
    <table>{/* render tk.rows */}</table>
  </>
);
```

Options: `getText(row, key)` when a column's visible text is derived; `labels` to translate the UI;
`enabled: false` to switch it off for one table.

## What you get

- **Global search** across every column (every word must match; Arabic-normalised: diacritics,
  alef / ya / ta-marbuta forms, Arabic-Indic digits).
- **Per-column search** ("contains") and **per-column filter** (dropdown of that column's distinct values),
  several columns at once.
- Screen-only toolbar (class `no-print`). Add to your CSS:
  `@media print { .no-print { display: none !important; } }`

## Off switch

Set `NEXT_PUBLIC_DISABLE_TABLEKIT=1` to turn every table back to plain, without touching any code.

## Pure logic

`query.ts` (`filterRows`, `distinctValues`, `normalizeText`) has no React and can be reused or unit-tested anywhere.
