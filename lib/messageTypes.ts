// أنواع مراسلات أولياء الأمور. لكل مدرسة أن تُعدّل صياغة كل نوع (جدول notification_templates)؛ ما هنا هو الصياغة الافتراضية والمتغيرات المتاحة.
// المتغيرات تُكتب بين أقواس معقوفة: {الطالب}. عند واتساب الرسمي يُحوَّل النص إلى {{1}}, {{2}}... بترتيب ظهورها.

export type MessageSource = "exam" | "term" | "supplementary" | "promotion";

export interface MessageType {
  key: string;
  label: string;
  source: MessageSource;
  tokens: string[];
  body: string;
  hint: string;
}

export const MESSAGE_TYPES: MessageType[] = [
  {
    key: "grade_result", label: "نتيجة امتحان", source: "exam", hint: "لكل طالب علامته في امتحان محدد.",
    tokens: ["الولي", "الطالب", "المادة", "الامتحان", "العلامة", "الحد", "الصف", "المدرسة"],
    body: "السلام عليكم {الولي}،\nنفيدكم بأن علامة الطالب/ة {الطالب} في مادة {المادة} ({الامتحان}) هي {العلامة} من {الحد}.\nمع تحيات إدارة {المدرسة}، شكراً لثقتكم.",
  },
  {
    key: "grade_low", label: "تنبيه علامة دون حد النجاح", source: "exam", hint: "يُحدَّد افتراضياً من علامته دون حد النجاح فقط.",
    tokens: ["الولي", "الطالب", "المادة", "الامتحان", "العلامة", "الحد", "الصف", "المدرسة"],
    body: "السلام عليكم {الولي}،\nنودّ إعلامكم أن علامة الطالب/ة {الطالب} في مادة {المادة} ({الامتحان}) هي {العلامة} من {الحد}، وهي دون حد النجاح. نرجو التواصل مع إدارة {المدرسة} لمتابعة الأمر.",
  },
  {
    key: "term_result", label: "نتيجة الفصل", source: "term", hint: "معدل الطالب وترتيبه في شعبته لفصل محدد.",
    tokens: ["الولي", "الطالب", "الفصل", "المعدل", "الترتيب", "عدد_الطلاب", "الصف", "المدرسة"],
    body: "السلام عليكم {الولي}،\nنفيدكم بأن معدل الطالب/ة {الطالب} للفصل {الفصل} هو {المعدل}، وترتيبه/ها {الترتيب} من {عدد_الطلاب} طالباً في {الصف}.\nمع تحيات إدارة {المدرسة}، شكراً لثقتكم.",
  },
  {
    key: "supplementary_invite", label: "دعوة للامتحان التكميلي", source: "supplementary", hint: "للطلاب المستحقين في دور تكميلي، مع موعد تكتبه أنت.",
    tokens: ["الولي", "الطالب", "المواد", "الموعد", "المدرسة"],
    body: "السلام عليكم {الولي}،\nيحق للطالب/ة {الطالب} التقدّم للامتحان التكميلي في مادة {المواد}، وموعده {الموعد}. نرجو التأكد من الحضور.\nمع تحيات إدارة {المدرسة}، شكراً لكم.",
  },
  {
    key: "promotion_result", label: "نتيجة الترفيع", source: "promotion", hint: "نتيجة العام (مُرفَّع/غير مُرفَّع) بعد التكميلي.",
    tokens: ["الولي", "الطالب", "النتيجة", "الصف", "المدرسة"],
    body: "السلام عليكم {الولي}،\nنتيجة الطالب/ة {الطالب} في {الصف} للعام الدراسي: {النتيجة}. للاستفسار يرجى التواصل مع إدارة {المدرسة}.",
  },
];

export const typeByKey = (key: string) => MESSAGE_TYPES.find((t) => t.key === key);
export const defaultWaName = (key: string) => `${key}_ar`;

const TOKEN_RE = /\{([^{}]+)\}/g;

export function render(body: string, values: Record<string, string>) {
  return body.replace(TOKEN_RE, (m, k) => (k in values ? values[k] : m));
}

// المتغيرات بترتيب ظهورها (تتكرر إن تكرر المتغير)
export function tokensInOrder(body: string): string[] {
  return [...body.matchAll(TOKEN_RE)].map((m) => m[1]);
}

// النص الذي يُقدَّم لواتساب للاعتماد: كل متغير يصبح {{n}} بالتسلسل
export function toMetaBody(body: string) {
  let i = 0;
  return body.replace(TOKEN_RE, () => `{{${++i}}}`);
}

// قيم متغيرات القالب بالترتيب: بلا أسطر جديدة (شرط واتساب) وغير فارغة
export function paramsFromBody(body: string, values: Record<string, string>): string[] {
  return tokensInOrder(body).map((k) => (values[k] ?? "").replace(/\s+/g, " ").trim() || "-");
}

// تحذيرات صياغة: بعضها يرفضه واتساب عند اعتماد القالب
export function validateBody(body: string, allowed: string[]): string[] {
  const out: string[] = [];
  const t = body.trim();
  if (!t) return ["النص فارغ"];
  const toks = tokensInOrder(body);
  const unknown = [...new Set(toks.filter((k) => !allowed.includes(k)))];
  if (unknown.length) out.push(`متغيرات غير معروفة لهذا النوع: ${unknown.map((k) => `{${k}}`).join("، ")}`);
  if (/^\{[^{}]+\}/.test(t)) out.push("لا يجوز أن يبدأ النص بمتغير (واتساب يرفضه)");
  if (/\{[^{}]+\}$/.test(t)) out.push("لا يجوز أن ينتهي النص بمتغير (واتساب يرفضه) — أضف جملة ختامية");
  if (/\}\s*\{/.test(body)) out.push("متغيران متجاوران بلا نص بينهما (واتساب يرفضه)");
  if (toks.length === 0) out.push("النص بلا أي متغير — سيُرسل النص نفسه للجميع");
  return out;
}

// رقم دولي بلا + أو أصفار بادئة: يزيل الرموز، 00 → دولي، والصفر المحلي يُستبدل برمز الدولة
export function normalizePhone(raw: string | null, cc: string): string | null {
  if (!raw) return null;
  let d = raw.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = cc + d.slice(1);
  else if (cc && d.length <= 8) d = cc + d;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);
