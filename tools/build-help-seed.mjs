// Generates the seed half of the help-center migration from guides/*.md (single source for the guide texts).
// Usage: node tools/build-help-seed.mjs > help_seed.sql   (then paste into a new numbered migration, or run in SQL)
// The statement is idempotent: it upserts by slug and only overwrites rows that were NOT edited in the app
// (updated_by is null), so edits made by the platform owner in /platform are never silently replaced.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ARTICLES = [
  { slug: "teacher-guide", file: "TEACHER_GUIDE_AR.md", title: "دليل الأستاذ", audience: "everyone", order: 10,
    summary: "تسجيل الدخول، إدخال العلامات، الإدخال الصوتي، وأسباب رفض الحفظ." },
  { slug: "supervisor-guide", file: "SUPERVISOR_GUIDE_AR.md", title: "دليل المشرفين", audience: "everyone", order: 20,
    summary: "مشرف الشعبة والطابق والمرحلة والمبنى: النطاق، تصاعد الصلاحية، والمتابعة." },
  { slug: "school-admin-guide", file: "SCHOOL_ADMIN_GUIDE_AR.md", title: "دليل الناظر العام / مدير المدرسة", audience: "school_admin", order: 30,
    summary: "تهيئة المدرسة أول مرة، الإدارة المستمرة، التقارير، ومراسلات أولياء الأمور." },
  { slug: "master-guide", file: "MASTER_GUIDE_AR.md", title: "الدليل الشامل للمستويات والصلاحيات", audience: "school_admin", order: 40,
    summary: "الهرم كاملاً من مالك المنصة إلى أدق صلاحية، مع جدول الصلاحيات الـ23." },
  { slug: "platform-owner-guide", file: "PLATFORM_OWNER_GUIDE_AR.md", title: "دليل مالك المنصة", audience: "platform", order: 50,
    summary: "إنشاء الحسابات وحدودها، الإضافات، المخالفات، قاموس الألفاظ، وخلفية المنصة." },
];

const SLUG_BY_FILE = Object.fromEntries(ARTICLES.map((a) => [a.file, a.slug]));

// Relative links to other guides become in-app links (help:<slug>); links to repo-only documents become plain text.
function fixLinks(md) {
  return md.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    if (/^https?:/i.test(href)) return m;
    const file = href.split("/").pop();
    if (!SLUG_BY_FILE[file]) return text;
    // a link whose visible text is the file name reads better as the guide's title
    const label = /\.md$/i.test(text) ? ARTICLES.find((a) => a.file === file).title : text;
    return `[${label}](help:${SLUG_BY_FILE[file]})`;
  });
}

const lit = (s) => `'${s.replace(/'/g, "''")}'`;

const rows = ARTICLES.map((a) => {
  const body = fixLinks(readFileSync(join(root, "guides", a.file), "utf8").replace(/\r\n/g, "\n")).trim();
  if (body.includes("$help_body$")) throw new Error("body contains the dollar-quote tag");
  return `  (${lit(a.slug)}, ${lit(a.title)}, ${lit(a.summary)}, ${lit(a.audience)}, ${a.order}, $help_body$${body}$help_body$)`;
});

console.log(`insert into help_articles (slug, title, summary, audience, sort_order, body_md) values
${rows.join(",\n")}
on conflict (slug) do update
  set title = excluded.title, summary = excluded.summary, audience = excluded.audience,
      sort_order = excluded.sort_order, body_md = excluded.body_md, updated_at = now()
  where help_articles.updated_by is null;`);
