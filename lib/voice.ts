// محرك الإدخال الصوتي: تحويل جملة عربية منطوقة إلى (اسم، علامة) ومطابقة الاسم مع قائمة الطلاب.
// يدعم الفصحى واللهجة الشامية بالأرقام (خمسة وثمانين / خمسة وتمانين / تلاتة...) والأرقام المكتوبة (85 / ٨٥) و"ونص".

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function baseNormalize(s: string): string {
  return (s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[،,.؟?!؛;:]/g, (c) => (c === "." ? "." : " "))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------- الأرقام
const UNITS: Record<string, number> = {
  صفر: 0, زيرو: 0,
  واحد: 1, واحده: 1, احد: 1,
  اثنين: 2, اتنين: 2, اثنان: 2, اثنتين: 2, ثنتين: 2, تنتين: 2, اثنا: 2, اثني: 2,
  ثلاثه: 3, تلاته: 3, ثلاث: 3, تلات: 3, ثلث: 3,
  اربعه: 4, اربع: 4,
  خمسه: 5, خمس: 5,
  سته: 6, ست: 6,
  سبعه: 7, سبع: 7,
  ثمانيه: 8, تمانيه: 8, ثماني: 8, تماني: 8, ثمان: 8, تمان: 8, ثمنيه: 8, تمنيه: 8,
  تسعه: 9, تسع: 9,
  عشره: 10, عشر: 10,
};
const TEENS: Record<string, number> = {
  حداشر: 11, احداشر: 11, احدعش: 11,
  اثناشر: 12, طناشر: 12, تناشر: 12, اثنعش: 12, اطنعش: 12,
  تلتاشر: 13, ثلاثطعش: 13, تلطاشر: 13,
  اربعتاشر: 14, اربعطعش: 14,
  خمستاشر: 15, خمسطعش: 15,
  ستاشر: 16, سطعش: 16, ستطعش: 16,
  سبعتاشر: 17, سبعطعش: 17,
  تمنتاشر: 18, ثمانطعش: 18, تمانطعش: 18,
  تسعتاشر: 19, تسعطعش: 19,
};
const TENS: Record<string, number> = {
  عشرين: 20, عشرون: 20, تلاتين: 30, ثلاثين: 30, ثلاثون: 30, اربعين: 40, اربعون: 40, خمسين: 50, خمسون: 50,
  ستين: 60, ستون: 60, سبعين: 70, سبعون: 70, ثمانين: 80, تمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90,
};
const HUNDRED = new Set(["مئه", "ميه", "مايه", "مائه", "ميت", "مئات"]);
const HALF = new Set(["نص", "نصف", "ونص", "ونصف"]);

type NumTok =
  | { kind: "value"; v: number }
  | { kind: "hundred" }
  | { kind: "half" }
  | { kind: "point" }
  | { kind: "and" }
  | { kind: "digits"; text: string };

function classify(raw: string): NumTok | null {
  const t = raw;
  if (/^\d+(\.\d+)?$/.test(t)) return { kind: "digits", text: t };
  if (t === "و") return { kind: "and" };
  if (t === "فاصله" || t === "فاصلة" || t === "نقطه") return { kind: "point" };
  if (HALF.has(t)) return { kind: "half" };
  const strip = t.length > 2 && t.startsWith("و") ? t.slice(1) : t;
  for (const cand of t === strip ? [t] : [t, strip]) {
    if (HUNDRED.has(cand)) return { kind: "hundred" };
    if (cand in TEENS) return { kind: "value", v: TEENS[cand] };
    if (cand in TENS) return { kind: "value", v: TENS[cand] };
    if (cand in UNITS) return { kind: "value", v: UNITS[cand] };
    if (cand === "نص" || cand === "نصف") return { kind: "half" };
  }
  return null;
}

function evalNumber(toks: NumTok[]): number | null {
  let total = 0;
  let any = false;
  let afterPoint = false;
  let decimal = "";
  for (const t of toks) {
    if (t.kind === "digits") return Number(t.text);
    if (t.kind === "value") { any = true; if (afterPoint) decimal += String(t.v); else total += t.v; }
    else if (t.kind === "hundred") { any = true; total += 100; }
    else if (t.kind === "half") { any = true; total += 0.5; }
    else if (t.kind === "point") afterPoint = true;
  }
  if (!any) return null;
  return decimal ? Number(`${total}.${decimal}`) : total;
}

export interface Utterance { name: string; score: number }

// جملة واحدة قد تحوي أكثر من (اسم + علامة): "محمد أحمد خمسة وثمانين علي تسعين"
export function parseUtterance(text: string): Utterance[] {
  const words = baseNormalize(text).split(" ").filter(Boolean);
  const out: Utterance[] = [];
  let nameToks: string[] = [];
  let numToks: NumTok[] = [];

  const flush = () => {
    if (nameToks.length > 0 && numToks.length > 0) {
      const v = evalNumber(numToks);
      if (v !== null) out.push({ name: nameToks.join(" "), score: v });
    }
    nameToks = []; numToks = [];
  };

  for (const w of words) {
    const c = classify(w);
    const isNum = c !== null && !(c.kind === "and" && numToks.length === 0);
    if (isNum) {
      numToks.push(c as NumTok);
    } else {
      if (numToks.length > 0) flush();
      nameToks.push(w === "و" ? w : w);
    }
  }
  flush();
  return out.map((u) => ({ ...u, name: u.name.replace(/^و\s+/, "").trim() })).filter((u) => u.name.length > 0);
}

// ---------------------------------------------------------------- مطابقة الأسماء
// هيكل صوتي: يوحّد الحروف التي تختلط عند النطق أو التعرّف (ص/س، ض/د، ظ/ذ/ز، ط/ت، ث/س، ق/ك ...)
function skeleton(s: string): string {
  return baseNormalize(s)
    .replace(/ث/g, "س").replace(/ذ|ظ/g, "ز").replace(/ض/g, "د").replace(/ص/g, "س").replace(/ط/g, "ت")
    .replace(/ق/g, "ك").replace(/[ءئؤ]/g, "ا")
    .replace(/(^|\s)عبد\s+/g, "$1عبد")
    .replace(/(^|\s)ال/g, "$1")
    .split(" ")
    // نهاية الاسم (ى/ا/ه/ي) تُنطق وتُكتب بأشكال مختلفة: ليلى/ليلا، سارة/سارا
    .map((t) => (t.length > 2 ? t.replace(/[اهي]$/, "ا") : t))
    .join(" ");
}

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a); const B = bigrams(b);
  const map = new Map<string, number>();
  for (const x of A) map.set(x, (map.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of B) { const n = map.get(x) ?? 0; if (n > 0) { inter++; map.set(x, n - 1); } }
  return (2 * inter) / (A.length + B.length);
}

export function nameSimilarity(spoken: string, studentName: string): number {
  const a = skeleton(spoken);
  const b = skeleton(studentName);
  const full = dice(a, b);
  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  if (at.length === 0 || bt.length === 0) return 0;
  // كل كلمة منطوقة تقابل أفضل كلمة باسم الطالب (يسمح بنطق الاسم الأول فقط)
  const tokenAvg = at.reduce((s, t) => s + Math.max(...bt.map((u) => dice(t, u))), 0) / at.length;
  const coverage = Math.min(1, at.length / Math.min(bt.length, 2)); // ذكر الاسم الأول فقط مقبول لكن أقل يقيناً
  return Math.max(full, tokenAvg * (0.85 + 0.15 * coverage));
}

export interface Candidate { id: string; name: string; score: number }
export type MatchStatus = "matched" | "ambiguous" | "unmatched";
export interface MatchResult { status: MatchStatus; best: Candidate | null; candidates: Candidate[] }

export function matchStudent(spoken: string, roster: { id: string; name: string }[]): MatchResult {
  const ranked = roster
    .map((s) => ({ id: s.id, name: s.name, score: nameSimilarity(spoken, s.name) }))
    .sort((x, y) => y.score - x.score);
  const top = ranked.slice(0, 3);
  const best = top[0] ?? null;
  const second = top[1];
  if (!best || best.score < 0.5) return { status: "unmatched", best: null, candidates: top };
  if (best.score >= 0.75 && (!second || second.score < best.score - 0.08)) return { status: "matched", best, candidates: top };
  return { status: "ambiguous", best, candidates: top };
}
