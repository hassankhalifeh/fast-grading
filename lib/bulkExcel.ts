// استيراد Excel شامل: ملف واحد متعدد الأوراق (مواد/مراحل/صفوف/طلاب/معلمون) بدل رفع كل جدول على حدة.
// هذا الملف هو المصدر الوحيد لأسماء الأوراق وعناوين الأعمدة، يستعملها كل من مولّد النموذج ومحرّك الاستيراد
// حتى لا يختلفا عن بعض. النموذج المُصدَّر يحمل هذه العناوين بالضبط، فلا حاجة لتخمين الأعمدة كما في ملفات CSV المفردة.

export interface SheetDef {
  name: string;
  headers: string[];
  hint: string;
}

export const SUBJECTS_SHEET: SheetDef = {
  name: "المواد",
  headers: ["اسم المادة"],
  hint: "اسم كل مادة يُدرَّس، سطر لكل مادة.",
};

export const STAGES_SHEET: SheetDef = {
  name: "المراحل",
  headers: ["اسم المرحلة", "الترتيب (اختياري)"],
  hint: "المراحل الدراسية (ابتدائي، متوسط...)؛ الترتيب رقم لعرضها بالتسلسل الصحيح.",
};

export const CLASSES_SHEET: SheetDef = {
  name: "الصفوف",
  headers: ["اسم الصف", "المستوى (اختياري)", "الشعبة (اختياري)", "المرحلة (اختياري - اكتب الاسم كما في ورقة المراحل)"],
  hint: "شعبة واحدة لكل سطر. عمود «المرحلة» اختياري ويربط الشعبة بمرحلة من ورقة المراحل إن ذكرتها هناك أولاً.",
};

export const STUDENTS_SHEET: SheetDef = {
  name: "الطلاب",
  headers: ["اسم الطالب", "الصف (اكتب الاسم كما في ورقة الصفوف)", "اسم ولي الأمر (اختياري)", "هاتف ولي الأمر (اختياري)", "بريد ولي الأمر (اختياري)"],
  hint: "طالب واحد لكل سطر. عمود «الصف» إلزامي ويجب أن يطابق اسماً موجوداً فعلاً أو مذكوراً في ورقة الصفوف.",
};

export const TEACHERS_SHEET: SheetDef = {
  name: "المعلمون (دعوات)",
  headers: ["الاسم", "البريد الإلكتروني", "الهاتف (اختياري)", "الدور (معلم مادة / مساعد ناظر / ناظر عام)"],
  hint: "يُرسَل لكل بريد دعوة تسجيل دخول (نفس دعوات شاشة المستخدمين). اترك عمود الدور فارغاً ليكون «معلم مادة» تلقائياً.",
};

export const ALL_SHEETS: SheetDef[] = [SUBJECTS_SHEET, STAGES_SHEET, CLASSES_SHEET, STUDENTS_SHEET, TEACHERS_SHEET];

export const ROLE_TEXT_TO_KEY: Record<string, string> = {
  "ناظر عام": "school_admin",
  "مساعد ناظر": "assistant_admin",
  "معلم مادة": "subject_teacher",
};

export type ImportRowResult = { sheet: string; row: number; item: string; status: "ok" | "skipped" | "error"; message: string };

// يبني مصنّف Excel (ورقة تعليمات + ورقة لكل جدول بعناوينها فقط) جاهزاً للتنزيل والتعبئة.
export async function buildTemplateWorkbook(): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grading SaaS";

  const intro = wb.addWorksheet("تعليمات", { views: [{ rightToLeft: true }] });
  intro.columns = [{ width: 100 }];
  const lines = [
    "نموذج استيراد جماعي — عبّئ الأوراق التالية ثم ارفع هذا الملف من «الاستيراد الجماعي → ملف Excel شامل».",
    "",
    "الترتيب مهم: املأ ورقة المواد والمراحل أولاً، ثم الصفوف (تعتمد على المراحل)، ثم الطلاب (يعتمدون على الصفوف)، ثم المعلمون أخيراً.",
    "لا تحذف عناوين الأعمدة في السطر الأول من كل ورقة. اترك الورقة فارغة إن لم تحتج بياناتها.",
    "الأعمدة المكتوب أمامها «اختياري» يمكن تركها فارغة.",
    "",
    ...ALL_SHEETS.map((s) => `• ${s.name}: ${s.hint}`),
  ];
  lines.forEach((l) => intro.addRow([l]));
  intro.getColumn(1).alignment = { wrapText: true, horizontal: "right" };

  for (const def of ALL_SHEETS) {
    const ws = wb.addWorksheet(def.name, { views: [{ rightToLeft: true }] });
    ws.addRow(def.headers);
    ws.getRow(1).font = { bold: true };
    ws.columns = def.headers.map(() => ({ width: 26 }));
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// يقرأ ملف Excel مرفوع ويحوّل كل ورقة معروفة إلى مصفوفة كائنات (مفتاح كل عمود = نص عنوانه بالسطر الأول).
export async function readWorkbookSheets(file: File): Promise<Record<string, Record<string, string>[]>> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  await wb.xlsx.load(buf);

  const out: Record<string, Record<string, string>[]> = {};
  for (const def of ALL_SHEETS) {
    const ws = wb.getWorksheet(def.name);
    if (!ws) continue;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, i) => { headers[i] = String(cell.value ?? "").trim(); });

    const rows: Record<string, string>[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj: Record<string, string> = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: true }, (cell, i) => {
        const key = headers[i];
        if (!key) return;
        const v = cell.value;
        const text = v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as any) ? String((v as any).text) : String(v);
        obj[key] = text.trim();
        if (obj[key]) hasValue = true;
      });
      obj.__row = String(rowNum);
      if (hasValue) rows.push(obj);
    });
    out[def.name] = rows;
  }
  return out;
}

// نموذج بورقة واحدة لجدول بعينه (الطلاب أو الصفوف أو المعلمون كلٌّ على حدة)، بعكس buildTemplateWorkbook
// الذي يبني الملف الشامل متعدد الأوراق. العناوين هنا يجب أن تطابق الكلمات التي يبحث عنها guessColumn
// في lib/csv.ts حتى يتعرّف الاستيراد المفرد على الأعمدة تلقائياً دون أي تغيير في منطقه.
export async function buildSingleSheetTemplate(sheetName: string, headers: string[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.columns = headers.map(() => ({ width: 26 }));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// يقرأ أول ورقة من ملف Excel مفرد كمصفوفة صفوف (نص عناوين أولاً) بنفس شكل خرج parseCsv تماماً،
// ليدخل في نفس مسار المطابقة والتعارضات المستعمل أصلاً لملفات CSV دون أي تعديل عليه.
export async function readFirstSheetAsRows(file: File): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      const text = v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as any) ? String((v as any).text) : String(v);
      cells.push(text.trim());
    });
    if (cells.some((c) => c !== "")) rows.push(cells);
  });
  return rows;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
