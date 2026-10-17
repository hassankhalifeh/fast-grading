// Small Markdown parser for the in-app help center (no dependency, no HTML output: the UI builds React elements from
// this AST, so article text can never inject markup). Supports what the guides use: #/##/### headings, paragraphs,
// bullet and numbered lists, tables, fenced code, block quotes, horizontal rules, **bold**, `code` and [text](url).

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "code"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "quote"; text: string }
  | { t: "hr" };

export interface Heading { id: string; level: number; text: string }

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else out.push({ t: "link", v: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isTableSep = (line: string) => line.includes("-") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(md: string): { blocks: Block[]; headings: Heading[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const headings: Heading[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push({ t: "code", text: buf.join("\n") });
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      const id = `h${headings.length}`;
      headings.push({ id, level, text: h[2].trim() });
      blocks.push({ t: "h", level, text: h[2].trim(), id });
      i++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push({ t: "hr" }); i++; continue; }

    if (line.trimStart().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", text: buf.join(" ") });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*[-*]\s+/, "");
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*\d+[.)]\s+/, "");
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      blocks.push({ t: "ol", items });
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !lines[i].trimStart().startsWith("```") && !/^#{1,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !lines[i].trimStart().startsWith("|") && !/^\s*>\s?/.test(lines[i])
    ) buf.push(lines[i++].trim());
    // a line no rule claimed (e.g. a stray table row) is kept as text rather than silently dropped
    if (buf.length === 0) buf.push(lines[i++].trim());
    blocks.push({ t: "p", text: buf.join(" ") });
  }
  return { blocks, headings };
}
