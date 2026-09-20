"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { matchStudent, parseUtterance, type Candidate, type MatchStatus } from "@/lib/voice";

interface Person { id: string; name: string }
interface Draft {
  id: number; heard: string; spokenName: string; score: number;
  studentId: string; status: MatchStatus; candidates: Candidate[];
}

const LANGS = [
  { v: "ar-LB", l: "العربية (لبنان)" }, { v: "ar-SA", l: "العربية (السعودية)" },
  { v: "ar-JO", l: "العربية (الأردن)" }, { v: "ar-EG", l: "العربية (مصر)" },
];
const lbl = { display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 } as const;

// الإدخال الصوتي: قل "اسم الطالب + العلامة" (مثلاً: محمد أحمد خمسة وثمانين). يظهر مسوّدة للمراجعة أولاً،
// وبعد "تطبيق" تنتقل العلامات لجدول الإدخال، ومنه الحفظ العادي (يمر بحل التعارض والقفل).
export default function VoiceEntry({ roster, components, maxScore, onApply }: {
  roster: Person[];
  components: { id: string; name: string }[] | null;
  maxScore: number;
  onApply: (rows: { studentId: string; componentId: string | null; score: number }[]) => void;
}) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("ar-LB");
  const [interim, setInterim] = useState("");
  const [compId, setCompId] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const nextId = useRef(1);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSupported(false);
    return () => { wantRef.current = false; recRef.current?.abort?.(); };
  }, []);

  useEffect(() => {
    if (components && components.length > 0 && !compId) setCompId(components[0].id);
  }, [components]);

  function handleText(text: string) {
    const parsed = parseUtterance(text);
    if (parsed.length === 0) { setIgnored((p) => [text, ...p].slice(0, 5)); return; }
    setDrafts((prev) => {
      const list = [...prev];
      for (const u of parsed) {
        const m = matchStudent(u.name, rosterRef.current);
        list.push({
          id: nextId.current++, heard: text, spokenName: u.name, score: u.score,
          studentId: m.status === "matched" && m.best ? m.best.id : "", status: m.status, candidates: m.candidates,
        });
      }
      return list;
    });
  }

  function start() {
    setError(null);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return setSupported(false);
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) handleText(r[0].transcript); else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { wantRef.current = false; setError("لم يُسمح بالميكروفون — اسمح به من إعدادات المتصفح ثم أعد المحاولة"); }
      else if (e.error === "no-speech" || e.error === "aborted") return;
      else setError("تعذّر التعرّف الصوتي: " + e.error);
    };
    rec.onend = () => { setInterim(""); if (wantRef.current) { try { rec.start(); } catch { /* يعيد التشغيل التالي */ } } else setListening(false); };
    recRef.current = rec;
    wantRef.current = true;
    try { rec.start(); setListening(true); } catch (err: any) { setError(err.message); }
  }

  function stop() {
    wantRef.current = false;
    recRef.current?.stop?.();
    setListening(false);
  }

  const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? "";
  const valid = (d: Draft) => d.studentId !== "" && d.score >= 0 && d.score <= maxScore;
  const dupIds = new Set(drafts.filter((d, i) => d.studentId && drafts.findIndex((x) => x.studentId === d.studentId) !== i).map((d) => d.id));

  function apply() {
    const ok = drafts.filter(valid);
    if (ok.length === 0) return;
    // إذا تكرر الطالب نأخذ آخر إملاء
    const last = new Map<string, Draft>();
    ok.forEach((d) => last.set(d.studentId, d));
    onApply([...last.values()].map((d) => ({ studentId: d.studentId, componentId: components && components.length > 0 ? compId : null, score: d.score })));
    setDrafts(drafts.filter((d) => !valid(d)));
  }

  if (!supported) {
    return (
      <div className="card" style={{ padding: "0.9rem 1.1rem", marginBottom: 14, fontSize: "0.85rem", color: "var(--steel)" }}>
        الإدخال الصوتي غير مدعوم بمتصفحك — استخدم Chrome أو Edge. (يمكنك مع ذلك لصق نص الإملاء بالأسفل.)
        <PasteBox typed={typed} setTyped={setTyped} onSubmit={() => { handleText(typed); setTyped(""); }} />
      </div>
    );
  }

  const statusColor = (s: MatchStatus) => (s === "matched" ? "var(--green)" : s === "ambiguous" ? "var(--gold-dark)" : "var(--red)");
  const statusText = (s: MatchStatus) => (s === "matched" ? "مطابق" : s === "ambiguous" ? "ملتبس — اختر" : "غير معروف — اختر");

  return (
    <div className="card" style={{ padding: "1rem 1.1rem", marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <button className="btn btn-gold" onClick={listening ? stop : start}>
          {listening ? <><Square size={14} /> إيقاف</> : <><Mic size={14} /> إدخال صوتي</>}
        </button>
        <div><label style={lbl}>اللهجة</label>
          <select className="input" style={{ maxWidth: 170 }} value={lang} disabled={listening} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
          </select></div>
        {components && components.length > 0 && (
          <div><label style={lbl}>المكوّن الذي تُملى علاماته</label>
            <select className="input" style={{ maxWidth: 200 }} value={compId} onChange={(e) => setCompId(e.target.value)}>
              {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        <span style={{ fontSize: "0.8rem", color: "var(--steel)" }}>قل: «اسم الطالب» ثم «العلامة» — مثال: محمد أحمد خمسة وثمانين</span>
      </div>
      {listening && <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--green)" }}>● أستمع... {interim && <span style={{ color: "var(--steel)" }}>{interim}</span>}</p>}
      {error && <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "var(--red)" }}>{error}</p>}
      <PasteBox typed={typed} setTyped={setTyped} onSubmit={() => { handleText(typed); setTyped(""); }} />

      {ignored.length > 0 && (
        <p style={{ fontSize: "0.78rem", color: "var(--steel)", margin: "8px 0 0" }}>لم أجد علامة في: {ignored.map((t) => `«${t}»`).join("، ")}</p>
      )}

      {drafts.length > 0 && (
        <>
          <table className="data-table" style={{ marginTop: 10 }}>
            <thead><tr><th>سُمع</th><th>الطالب</th><th>العلامة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontSize: "0.85rem" }}>{d.spokenName}</td>
                  <td>
                    <select className="input" style={{ maxWidth: 220, borderColor: d.studentId ? undefined : "var(--red)" }} value={d.studentId}
                      onChange={(e) => setDrafts((p) => p.map((x) => (x.id === d.id ? { ...x, studentId: e.target.value } : x)))}>
                      <option value="">— اختر الطالب —</option>
                      {roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    {!d.studentId && d.candidates.filter((c) => c.score >= 0.5).map((c) => (
                      <button key={c.id} className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 8px", marginInlineStart: 4 }}
                        onClick={() => setDrafts((p) => p.map((x) => (x.id === d.id ? { ...x, studentId: c.id } : x)))}>{c.name}</button>
                    ))}
                  </td>
                  <td>
                    <input type="number" className="input" style={{ width: 90, borderColor: d.score < 0 || d.score > maxScore ? "var(--red)" : undefined }} value={d.score}
                      onChange={(e) => setDrafts((p) => p.map((x) => (x.id === d.id ? { ...x, score: e.target.valueAsNumber } : x)))} />
                  </td>
                  <td style={{ fontSize: "0.8rem", fontWeight: 700, color: d.studentId ? "var(--green)" : statusColor(d.status) }}>
                    {d.studentId ? (d.status === "matched" ? "مطابق ✓" : "تم اختياره") : statusText(d.status)}
                    {d.score > maxScore && " — أكبر من " + maxScore}
                    {dupIds.has(d.id) && <span style={{ color: "var(--gold-dark)" }}> — مكرر (يُؤخذ الأخير)</span>}
                  </td>
                  <td><button onClick={() => setDrafts((p) => p.filter((x) => x.id !== d.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)" }}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button className="btn btn-gold" disabled={!drafts.some(valid)} onClick={apply}>تطبيق {drafts.filter(valid).length} علامة على الجدول</button>
            <button className="btn btn-secondary" onClick={() => setDrafts([])}>مسح المسوّدة</button>
            <span style={{ fontSize: "0.78rem", color: "var(--steel)" }}>التطبيق لا يحفظ: راجع الجدول ثم اضغط «حفظ العلامات».</span>
          </div>
        </>
      )}
    </div>
  );
}

function PasteBox({ typed, setTyped, onSubmit }: { typed: string; setTyped: (s: string) => void; onSubmit: () => void }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input className="input" style={{ maxWidth: 380 }} value={typed} placeholder="أو اكتب/الصق الإملاء هنا ثم Enter" onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) onSubmit(); }} />
      <button className="btn btn-secondary" disabled={!typed.trim()} onClick={onSubmit}>إضافة</button>
    </div>
  );
}
