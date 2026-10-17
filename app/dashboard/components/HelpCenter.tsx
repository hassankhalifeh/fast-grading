"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeAr } from "@/lib/csv";
import { parseInline, parseMarkdown, type Block, type Inline } from "@/lib/miniMarkdown";
import { BookOpenText, ChevronRight, Search } from "lucide-react";

interface Article { id: string; slug: string; title: string; summary: string | null; audience: string; sort_order: number; body_md: string; updated_at: string }

const AUDIENCE_LABEL: Record<string, string> = { everyone: "للجميع", school_admin: "للإدارة", platform: "لمالك المنصة" };
const stripMd = (s: string) => s.replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^[\s>#*\-|\d.)]+/, "").trim();

// مركز المساعدة: الأدلة محفوظة في قاعدة البيانات (help_articles)، وسياسة RLS تعرض لكل مستخدم ما يخص دوره فقط.
// initialSlugs/initialHint: فتح أول مقال متاح من القائمة (حسب دور المستخدم) والنزول إلى العنوان المناسب (زر «؟» في أعلى كل شاشة).
export default function HelpCenter({ initialSlugs, initialHint }: { initialSlugs?: string[]; initialHint?: string }) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [hint, setHint] = useState<string | undefined>(initialHint);
  const [query, setQuery] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("help_articles").select("id, slug, title, summary, audience, sort_order, body_md, updated_at").order("sort_order")
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        const list = (data ?? []) as Article[];
        setArticles(list);
        const first = initialSlugs?.find((s) => list.some((a) => a.slug === s));
        if (first) setSlug(first);
      });
  }, []);

  const q = normalizeAr(query);
  const results = useMemo(() => {
    if (!articles || !q) return [];
    return articles.flatMap((a) => {
      const inTitle = normalizeAr(a.title + " " + (a.summary ?? "")).includes(q);
      let heading = "";
      let snippet = "";
      let inCode = false;
      for (const line of a.body_md.split("\n")) {
        if (line.trimStart().startsWith("```")) { inCode = !inCode; continue; }
        if (inCode) continue;
        const h = /^#{1,3}\s+(.*)$/.exec(line);
        if (h) { heading = h[1].trim(); if (normalizeAr(heading).includes(q) && !snippet) snippet = heading; continue; }
        if (!snippet && normalizeAr(line).includes(q)) snippet = stripMd(line);
        if (snippet) break;
      }
      return inTitle || snippet ? [{ article: a, heading, snippet: snippet || (a.summary ?? "") }] : [];
    });
  }, [articles, q]);

  const current = articles?.find((a) => a.slug === slug) ?? null;
  const parsed = useMemo(() => (current ? parseMarkdown(current.body_md) : null), [current]);

  // بعد فتح مقال: النزول إلى العنوان المطلوب إن وُجد، وإلا إلى أعلى المقال
  useEffect(() => {
    if (!current || !parsed) return;
    const target = hint ? parsed.headings.find((h) => normalizeAr(h.text).includes(normalizeAr(hint))) : null;
    const el = target ? document.getElementById(`help-${target.id}`) : readerRef.current;
    el?.scrollIntoView({ block: "start", behavior: target ? "smooth" : "auto" });
  }, [current, parsed, hint]);

  function open(s: string, h?: string) { setSlug(s); setHint(h); setQuery(""); }

  const renderInline = (text: string) =>
    parseInline(text).map((t: Inline, i) => {
      if (t.t === "b") return <strong key={i}>{t.v}</strong>;
      if (t.t === "code") return <code key={i} dir="ltr" style={{ fontFamily: "var(--font-mono)", fontSize: "0.82em", background: "var(--fog)", padding: "1px 6px", borderRadius: 5 }}>{t.v}</code>;
      if (t.t === "link") {
        if (t.href.startsWith("help:")) return <button key={i} type="button" onClick={() => open(t.href.slice(5))} style={{ background: "none", border: "none", padding: 0, color: "var(--indigo)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>{t.v}</button>;
        if (/^https?:\/\//i.test(t.href)) return <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">{t.v}</a>;
        return <Fragment key={i}>{t.v}</Fragment>;
      }
      return <Fragment key={i}>{t.v}</Fragment>;
    });

  const renderBlock = (b: Block, i: number) => {
    switch (b.t) {
      case "h": {
        const size = b.level === 1 ? "1.35rem" : b.level === 2 ? "1.12rem" : "0.98rem";
        return <div key={i} id={`help-${b.id}`} style={{ fontSize: size, fontWeight: 800, color: "var(--indigo)", margin: b.level === 1 ? "0 0 10px" : "22px 0 8px", scrollMarginTop: 12, fontFamily: "var(--font-display)" }}>{b.text}</div>;
      }
      case "p": return <p key={i} style={{ lineHeight: 1.95, margin: "0 0 10px", fontSize: "0.93rem" }}>{renderInline(b.text)}</p>;
      case "quote": return <p key={i} style={{ borderInlineStart: "3px solid var(--gold)", padding: "4px 12px", margin: "0 0 10px", color: "var(--steel)", fontSize: "0.9rem" }}>{renderInline(b.text)}</p>;
      case "ul": return <ul key={i} style={{ margin: "0 0 10px", paddingInlineStart: 22, lineHeight: 1.9, fontSize: "0.93rem" }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
      case "ol": return <ol key={i} style={{ margin: "0 0 10px", paddingInlineStart: 24, lineHeight: 1.9, fontSize: "0.93rem" }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
      case "code": return <pre key={i} dir="ltr" style={{ background: "var(--fog)", borderRadius: 8, padding: "10px 12px", margin: "0 0 10px", overflowX: "auto", fontFamily: "var(--font-mono)", fontSize: "0.8rem", lineHeight: 1.6 }}>{b.text}</pre>;
      case "hr": return <hr key={i} style={{ border: "none", borderTop: "1px solid var(--fog-dark)", margin: "18px 0" }} />;
      case "table": return (
        <div key={i} className="card" style={{ overflowX: "auto", margin: "0 0 12px" }}>
          <table className="data-table" style={{ fontSize: "0.84rem" }}>
            <thead><tr>{b.head.map((c, j) => <th key={j}>{renderInline(c)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
  };

  if (articles === null) return <p style={{ color: "var(--steel)" }}>جارٍ التحميل...</p>;

  return (
    <div>
      {error && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>تعذّر تحميل الأدلة: {error}</p>}

      {!current && (
        <>
          <div style={{ position: "relative", maxWidth: 520, marginBottom: 16 }}>
            <Search size={16} style={{ position: "absolute", insetInlineStart: 12, top: 13, color: "var(--steel)" }} />
            <input className="input" style={{ paddingInlineStart: 36 }} placeholder="ابحث في كل الأدلة..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {q ? (
            results.length === 0 ? <p style={{ color: "var(--steel)" }}>لا نتائج لـ «{query}».</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results.map((r) => (
                  <button key={r.article.id} type="button" className="card" onClick={() => open(r.article.slug, r.heading || undefined)}
                    style={{ textAlign: "start", padding: "0.85rem 1.1rem", border: "none", cursor: "pointer", font: "inherit" }}>
                    <div style={{ fontWeight: 800, color: "var(--indigo)" }}>{r.article.title}{r.heading && <span style={{ fontWeight: 500, color: "var(--steel)" }}> ← {r.heading}</span>}</div>
                    {r.snippet && <div style={{ fontSize: "0.85rem", color: "var(--steel)", marginTop: 4 }}>{r.snippet}</div>}
                  </button>
                ))}
              </div>
            )
          ) : articles.length === 0 ? (
            <p style={{ color: "var(--steel)" }}>لا توجد أدلة متاحة لحسابك حالياً.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {articles.map((a) => (
                <button key={a.id} type="button" className="card" onClick={() => open(a.slug)}
                  style={{ textAlign: "start", padding: "1rem 1.1rem", border: "none", cursor: "pointer", font: "inherit", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "var(--indigo)" }}><BookOpenText size={17} /> {a.title}</span>
                  {a.summary && <span style={{ fontSize: "0.84rem", color: "var(--steel)", lineHeight: 1.7 }}>{a.summary}</span>}
                  <span style={{ fontSize: "0.72rem", color: "var(--steel-light)" }}>{AUDIENCE_LABEL[a.audience] ?? a.audience}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {current && parsed && (
        <div ref={readerRef}>
          <button type="button" className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "5px 12px", marginBottom: 14 }} onClick={() => { setSlug(null); setHint(undefined); }}>
            <ChevronRight size={14} /> كل الأدلة
          </button>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            <article className="card" style={{ flex: "1 1 520px", minWidth: 0, padding: "1.2rem 1.4rem" }}>
              {parsed.blocks.map(renderBlock)}
              <div style={{ fontSize: "0.72rem", color: "var(--steel-light)", marginTop: 16 }}>آخر تحديث: {new Date(current.updated_at).toLocaleDateString("ar")}</div>
            </article>
            {parsed.headings.filter((h) => h.level >= 2).length > 2 && (
              <nav className="card" style={{ flex: "0 1 230px", padding: "0.9rem 1rem", position: "sticky", top: 8, maxHeight: "70vh", overflowY: "auto" }}>
                <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "var(--indigo)", marginBottom: 8 }}>في هذا الدليل</div>
                {parsed.headings.filter((h) => h.level >= 2).map((h) => (
                  <button key={h.id} type="button" onClick={() => document.getElementById(`help-${h.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
                    style={{ display: "block", width: "100%", textAlign: "start", background: "none", border: "none", cursor: "pointer", font: "inherit", fontSize: "0.8rem", color: "var(--steel)", padding: `4px ${h.level === 3 ? 12 : 0}px`, lineHeight: 1.6 }}>
                    {h.text}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
