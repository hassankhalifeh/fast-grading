import { readFileSync } from "node:fs";
import { parseMarkdown, parseInline } from "../lib/miniMarkdown.ts";

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

for (const f of ["TEACHER", "SUPERVISOR", "SCHOOL_ADMIN", "MASTER", "PLATFORM_OWNER"]) {
  const md = readFileSync(`guides/${f}_GUIDE_AR.md`, "utf8");
  const { blocks, headings } = parseMarkdown(md);
  const kinds = blocks.reduce((a: Record<string, number>, b) => ((a[b.t] = (a[b.t] ?? 0) + 1), a), {});
  console.log(f, "blocks:", blocks.length, "headings:", headings.length, JSON.stringify(kinds));
  ok(headings.length > 2, f + " has headings");
  // nothing from the source may leak as raw markup into paragraph/list text
  for (const b of blocks) {
    const texts = b.t === "p" || b.t === "quote" ? [b.text] : b.t === "ul" || b.t === "ol" ? b.items : b.t === "table" ? [...b.head, ...b.rows.flat()] : [];
    for (const t of texts) ok(!/^\s*(#{1,3}\s|[-*]\s|\|)/.test(t), f + " raw markup leaked: " + t.slice(0, 40));
  }
  for (const b of blocks) if (b.t === "table") ok(b.rows.every((r) => r.length === b.head.length), f + " ragged table: " + b.head.join("|"));
}

const master = parseMarkdown(readFileSync("guides/MASTER_GUIDE_AR.md", "utf8"));
ok(master.blocks.filter((b) => b.t === "table").length >= 7, "master guide keeps its 7+ tables, got " + master.blocks.filter((b) => b.t === "table").length);
// no table row may survive as raw text anywhere
for (const f of ["TEACHER", "SUPERVISOR", "SCHOOL_ADMIN", "MASTER", "PLATFORM_OWNER"]) { const r = parseMarkdown(readFileSync(`guides/${f}_GUIDE_AR.md`, "utf8")); for (const b of r.blocks) if (b.t === "p") ok(!b.text.startsWith("|"), f + " table row leaked as paragraph: " + b.text.slice(0, 40)); }

const inl = parseInline("نص **غامق** و`code` و[رابط](https://x.y) و[دليل](help:teacher-guide) ختام");
ok(inl.map((x) => x.t).join() === "text,b,text,code,text,link,text,link,text", "inline kinds " + inl.map((x) => x.t).join());
const { blocks } = parseMarkdown("# عنوان\n\n1. أول\n2. ثان\n\n- أ\n- ب\n\n```\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
ok(blocks.map((b) => b.t).join() === "h,ol,ul,code,table", "block order " + blocks.map((b) => b.t).join());
console.log(fails ? `${fails} FAILURES` : "ALL OK");
process.exit(fails ? 1 : 0);
