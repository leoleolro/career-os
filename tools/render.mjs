#!/usr/bin/env node
// tools/render.mjs — turn a job folder's resume.md (+ cover-letter.md) into ATS-friendly PDF + DOCX in <folder>/outputs/.
//
//   node tools/render.mjs jobs/<slug>                              resume.md (+ cover-letter.md) → outputs/Resume_LeoLong_<Company>.{html,pdf,docx}
//   node tools/render.mjs jobs/<slug> --name Resume_LeoLong_BCG    override the base file name (cover letter → CoverLetter_…, combined → Application_…)
//   node tools/render.mjs jobs/<slug> --merge inbox/transcript.pdf [more.pdf …]
//                                                                  also write ONE combined PDF: resume + cover letter + the extra PDFs (BCG X wants CV+CL+transcript in one file)
//   node tools/render.mjs jobs/<slug> --combine                    combined PDF of resume + cover letter without extras
//   node tools/render.mjs profile                                  preview of profile/master-resume.md → profile/outputs/
//   flags: --no-pdf  --no-docx  --chrome "/path/to/Chrome"  --verbose
//
// Pipeline: Markdown → tiny built-in parser (AST) → (a) HTML + CSS → headless Chrome → PDF, verified with pypdf
//                                                  → (b) DOCX via the `docx` package (real Heading styles + real bullets, no tables/text boxes)
// The HTML is kept next to the PDF for debugging. No network. Only dependency: docx (MIT).
//
// Markdown conventions the renderer understands (keep tailored resumes to these — they are what ATS parsers cope with):
//   # Name                          → H1 (the candidate's name)
//   Perth WA | +61 … | email | url  → the paragraph right after the H1 becomes the contact line
//   ## Section                      → small-caps heading with a bottom rule
//   ### Job title — Company | dates → job heading; the heading + everything until the next heading is kept on one page where possible
//   - bullets (nested by 2 spaces), 1. numbered, **bold**, *italic*, `code`, [text](url), --- rule, | simple | tables |, > quotes
//
// Chrome note (verified 2026-09-12, Chrome 153 on macOS 15): do NOT pass --user-data-dir — with a custom profile dir Chrome writes the
// PDF and then never exits. Without it, it exits in ~1 s and coexists with a normally running Chrome. A watchdog kills it anyway once
// the PDF stops growing, so a lingering process can never hang the tool.
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

// ───────────────────────────── CLI ─────────────────────────────
const IS_CLI = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const argv = IS_CLI ? process.argv.slice(2) : [];
const opts = { name: null, merge: [], pdf: true, docx: true, combine: false, chrome: null, verbose: false, folder: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--name') opts.name = argv[++i];
  else if (a === '--compact') opts.compact = true;
  else if (a === '--chrome') opts.chrome = argv[++i];
  else if (a === '--merge') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.merge.push(argv[++i]); }
  else if (a === '--combine') opts.combine = true;
  else if (a === '--no-pdf') opts.pdf = false;
  else if (a === '--no-docx') opts.docx = false;
  else if (a === '--verbose' || a === '-v') opts.verbose = true;
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else if (a.startsWith('--')) { console.error(`Unknown flag ${a}`); usage(); process.exit(2); }
  else if (!opts.folder) opts.folder = a;
  else { console.error(`Unexpected argument ${a}`); usage(); process.exit(2); }
}
if (IS_CLI && !opts.folder) { usage(); process.exit(2); }

function usage() {
  console.error('Usage: node tools/render.mjs <jobs/<slug> | profile> [--name Resume_LeoLong_BCG] [--merge extra.pdf ...] [--combine] [--no-pdf] [--no-docx] [--chrome path] [--verbose]');
}

// ───────────────────────────── Markdown → AST ─────────────────────────────
// Block nodes: heading{level,inlines} paragraph{inlines} list{ordered,start,items:[{inlines,children:[list]}]} hr table{header,rows} quote{blocks} code{text}
// Inline nodes: text{v} bold{c} em{c} code{v} link{href,c} br
const RE = {
  heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  li: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,
  tableRow: /^\s*\|.*\|\s*$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
  quote: /^\s*>\s?(.*)$/,
  fence: /^\s*(```|~~~)/,
};

export function parseMarkdown(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)));
  return parseBlocks(lines);
}

const indentOf = (l) => l.match(/^ */)[0].length;
function isBlockStart(line, next) {
  return RE.heading.test(line) || RE.hr.test(line) || RE.li.test(line) || RE.fence.test(line) || RE.quote.test(line)
    || (RE.tableRow.test(line) && next != null && RE.tableSep.test(next));
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (RE.fence.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !RE.fence.test(lines[i])) buf.push(lines[i++]);
      i++; blocks.push({ type: 'code', text: buf.join('\n') }); continue;
    }
    if ((m = line.match(RE.heading))) { blocks.push({ type: 'heading', level: m[1].length, inlines: parseInlines(m[2]) }); i++; continue; }
    if (RE.hr.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const header = splitRow(line); i += 2; const rows = [];
      while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', header: header.map(parseInlines), rows: rows.map((r) => r.map(parseInlines)) }); continue;
    }
    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].match(RE.quote)[1]);
      blocks.push({ type: 'quote', blocks: parseBlocks(buf) }); continue;
    }
    if (RE.li.test(line)) { const r = parseList(lines, i); blocks.push(r.list); i = r.next; continue; }
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) buf.push(lines[i++]);
    blocks.push({ type: 'paragraph', inlines: parseParagraphLines(buf) });
  }
  return blocks;
}

function splitRow(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseList(lines, start) {
  const items = []; let i = start; let ordered = null; let startNo = 1; let baseIndent = null;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i; while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const nm = RE.li.test(lines[j]); const ind = indentOf(lines[j]);
      if ((nm && ind >= baseIndent) || (!nm && ind > baseIndent && !isBlockStart(lines[j].trim(), lines[j + 1]))) { i = j; continue; }
      break;
    }
    const m = line.match(RE.li); const ind = indentOf(line);
    if (m && (baseIndent === null || ind <= baseIndent)) {
      if (baseIndent === null) { baseIndent = ind; ordered = /^\d/.test(m[2]); if (ordered) startNo = parseInt(m[2], 10) || 1; }
      else if (ind < baseIndent) break;
      items.push({ text: [m[3]], children: [] }); i++; continue;
    }
    if (m && ind > baseIndent && items.length) { const sub = parseList(lines, i); items[items.length - 1].children.push(sub.list); i = sub.next; continue; }
    if (!m && items.length && !isBlockStart(line.trim(), lines[i + 1])) { items[items.length - 1].text.push(line.trim()); i++; continue; }
    break;
  }
  const out = items.map((it) => ({ inlines: parseParagraphLines(it.text), children: it.children }));
  return { list: { type: 'list', ordered: !!ordered, start: startNo, items: out }, next: i };
}

function parseParagraphLines(buf) {
  const out = [];
  buf.forEach((raw, idx) => {
    const hard = /( {2,}|\\)$/.test(raw);
    const text = raw.replace(/( {2,}|\\)$/, '').trim();
    if (idx > 0 && out[out.length - 1]?.t !== 'br') out.push({ t: 'text', v: ' ' });
    out.push(...parseInlines(text));
    if (hard && idx < buf.length - 1) out.push({ t: 'br' });
  });
  return out;
}

export function parseInlines(src) {
  const out = []; let i = 0; let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < src.length) {
    const ch = src[i]; const rest = src.slice(i); let m;
    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === '<' && (m = rest.match(/^<br\s*\/?>/i))) { flush(); out.push({ t: 'br' }); i += m[0].length; continue; }
    if (ch === '`' && (m = rest.match(/^`([^`]+)`/))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if (ch === '[' && (m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/))) { flush(); out.push({ t: 'link', href: m[2], c: parseInlines(m[1]) }); i += m[0].length; continue; }
    if (ch === '<' && (m = rest.match(/^<((?:https?:\/\/|mailto:)[^>\s]+)>/))) { flush(); out.push({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1].replace(/^mailto:/, '') }] }); i += m[0].length; continue; }
    if (ch === 'h' && (m = rest.match(/^(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])/))) { flush(); out.push({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1] }] }); i += m[0].length; continue; }
    if ((ch === '*' || ch === '_') && (m = rest.match(/^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/))) { flush(); out.push({ t: 'bold', c: parseInlines(m[2]) }); i += m[0].length; continue; }
    if (ch === '*' && (m = rest.match(/^\*(?=\S)([^*]+?)(?<=\S)\*/))) { flush(); out.push({ t: 'em', c: parseInlines(m[1]) }); i += m[0].length; continue; }
    if (ch === '_' && (i === 0 || /[^A-Za-z0-9]/.test(src[i - 1])) && (m = rest.match(/^_(?=\S)([^_]+?)(?<=\S)_(?![A-Za-z0-9])/))) { flush(); out.push({ t: 'em', c: parseInlines(m[1]) }); i += m[0].length; continue; }
    buf += ch; i++;
  }
  flush();
  return out;
}

export const plainText = (inlines) => inlines.map((n) => n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : n.c ? plainText(n.c) : '').join('');

// ───────────────────────────── AST → HTML ─────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlinesToHtml(inlines) {
  return inlines.map((n) => {
    switch (n.t) {
      case 'text': return esc(n.v);
      case 'bold': return `<strong>${inlinesToHtml(n.c)}</strong>`;
      case 'em': return `<em>${inlinesToHtml(n.c)}</em>`;
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'link': return `<a href="${esc(n.href)}">${inlinesToHtml(n.c)}</a>`;
      case 'br': return '<br>';
      default: return '';
    }
  }).join('');
}

function listToHtml(list) {
  const tag = list.ordered ? 'ol' : 'ul';
  const attr = list.ordered && list.start !== 1 ? ` start="${list.start}"` : '';
  return `<${tag}${attr}>` + list.items.map((it) => `<li>${inlinesToHtml(it.inlines)}${it.children.map(listToHtml).join('')}</li>`).join('\n') + `</${tag}>`;
}

function blocksToHtml(blocks, kind) {
  const out = []; let sawH1 = false; let inJob = false;
  const closeJob = () => { if (inJob) { out.push('</div>'); inJob = false; } };
  blocks.forEach((b, idx) => {
    if (b.type === 'heading') closeJob();
    switch (b.type) {
      case 'heading': {
        const lvl = Math.min(b.level, 4);
        out.push(`<h${lvl}>${inlinesToHtml(b.inlines)}</h${lvl}>`);
        if (lvl === 1 && !sawH1) {
          sawH1 = true;
          const next = blocks[idx + 1];
          if (next?.type === 'paragraph') { next._contact = true; }
        }
        if (lvl === 3 && kind === 'resume') { out.push('<div class="job">'); inJob = true; }
        break;
      }
      case 'paragraph': out.push(`<p${b._contact ? ' class="contact"' : ''}>${inlinesToHtml(b.inlines)}</p>`); break;
      case 'list': out.push(listToHtml(b)); break;
      case 'hr': closeJob(); out.push('<hr>'); break;
      case 'quote': out.push(`<blockquote>${blocksToHtml(b.blocks, 'quote')}</blockquote>`); break;
      case 'code': out.push(`<pre>${esc(b.text)}</pre>`); break;
      case 'table': {
        const th = b.header.map((c) => `<th>${inlinesToHtml(c)}</th>`).join('');
        const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlinesToHtml(c)}</td>`).join('')}</tr>`).join('\n');
        out.push(`<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`); break;
      }
    }
  });
  closeJob();
  return out.join('\n');
}

const CSS = `
@page { size: A4; margin: 14mm 15mm; }
body.compact { font-size: 9.6pt; line-height: 1.24; } body.compact h1 { font-size: 17pt; } body.compact h2 { font-size: 10pt; margin: 7pt 0 2.5pt; } body.compact h3 { font-size: 9.8pt; margin: 4.5pt 0 1pt; } body.compact p { margin: 0 0 2.5pt; } body.compact li { margin: 0 0 1pt; } body.compact ul, body.compact ol { margin: 0.5pt 0 2.5pt; padding-left: 13pt; } body.compact p.contact { margin-bottom: 5pt; }
@page compact { margin: 11mm 13mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.32; color: #111; background: #fff; }
h1 { font-size: 20pt; font-weight: 700; letter-spacing: 0.3pt; margin: 0 0 2pt; line-height: 1.15; }
p.contact { font-size: 9.5pt; color: #333; margin: 0 0 9pt; }
/* all-small-caps (not small-caps): Chrome synthesises plain small-caps at two glyph sizes and PDF text then extracts as "E XPERIENCE",
   which breaks ATS section detection. all-small-caps + ≤1pt letter-spacing extracts as "EXPERIENCE" (verified with pypdf 2026-09-12). */
h2 { font-size: 11pt; font-weight: 700; font-variant: all-small-caps; letter-spacing: 0.8pt; margin: 11pt 0 4pt; padding-bottom: 1.5pt; border-bottom: 1px solid #333; }
h3 { font-size: 10.5pt; font-weight: 700; margin: 7pt 0 1.5pt; }
h4 { font-size: 10.5pt; font-weight: 700; font-style: italic; margin: 5pt 0 1pt; }
p { margin: 0 0 4pt; }
ul, ol { margin: 1pt 0 4pt; padding-left: 15pt; }
ul ul, ol ol, ul ol, ol ul { margin: 1pt 0 1pt; }
li { margin: 0 0 1.8pt; padding-left: 1pt; }
ul { list-style: disc; } ul ul { list-style: "– "; }
strong { font-weight: 700; } em { font-style: italic; }
code { font-family: Menlo, "Courier New", monospace; font-size: 9.5pt; }
pre { font-family: Menlo, "Courier New", monospace; font-size: 9pt; white-space: pre-wrap; margin: 0 0 6pt; }
a { color: inherit; text-decoration: none; }
hr { border: 0; border-top: 1px solid #999; margin: 8pt 0; }
blockquote { margin: 0 0 6pt; padding: 3pt 8pt; border-left: 2px solid #bbb; color: #444; font-style: italic; }
blockquote p { margin: 0 0 2pt; }
table { border-collapse: collapse; width: 100%; margin: 2pt 0 6pt; font-size: 9.5pt; }
th, td { border: 1px solid #bbb; padding: 2pt 5pt; text-align: left; vertical-align: top; }
th { font-weight: 700; background: #f2f2f2; }
/* print-friendly page breaks */
h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; break-inside: avoid; }
.job { break-inside: avoid; page-break-inside: avoid; }
li, tr, blockquote { break-inside: avoid; page-break-inside: avoid; }
/* cover letter: a little more air */
body.letter { font-size: 11pt; line-height: 1.42; }
body.letter p { margin: 0 0 9pt; }
body.letter h1 { font-size: 18pt; }
body.letter p.contact { margin-bottom: 14pt; }
@media screen { body { max-width: 180mm; margin: 12mm auto; padding: 0 10mm; } }
`;

export function markdownToHtml(md, { kind = 'resume', title = '', compact = false } = {}) {
  const blocks = parseMarkdown(md);
  const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  const docTitle = title || (h1 ? plainText(h1.inlines) : 'Document');
  const body = blocksToHtml(blocks, kind);
  const html = `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>${esc(docTitle)}</title><meta name="author" content="${esc(docTitle)}"><style>${CSS}</style></head>
<body class="${kind}${compact ? ' compact' : ''}">
${body}
</body></html>
`;
  return { html, blocks };
}

// ───────────────────────────── AST → DOCX ─────────────────────────────
async function loadDocx() {
  try { return await import('docx'); } catch (e) {
    throw new Error(`The "docx" package is missing — run: cd "${ROOT}" && npm install docx   (${e.message})`);
  }
}

export async function blocksToDocx(blocks, { kind = 'resume', title = '' } = {}) {
  const D = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat, BorderStyle, Table, TableRow, TableCell, ExternalHyperlink, WidthType, convertMillimetersToTwip: mm } = D;
  const letter = kind === 'letter';
  const base = letter ? 22 : 21; // half-points: 11pt / 10.5pt
  const pt = (n) => Math.round(n * 20); // points → twips

  const runs = (inlines, st = {}) => {
    const out = [];
    for (const n of inlines) {
      if (n.t === 'text') out.push(new TextRun({ text: n.v, bold: st.bold, italics: st.italic, style: st.link ? 'Hyperlink' : undefined }));
      else if (n.t === 'bold') out.push(...runs(n.c, { ...st, bold: true }));
      else if (n.t === 'em') out.push(...runs(n.c, { ...st, italic: true }));
      else if (n.t === 'code') out.push(new TextRun({ text: n.v, font: 'Courier New', bold: st.bold, italics: st.italic }));
      else if (n.t === 'br') out.push(new TextRun({ break: 1 }));
      else if (n.t === 'link') out.push(new ExternalHyperlink({ link: n.href, children: runs(n.c, { ...st, link: true }) }));
    }
    return out;
  };

  const children = [];
  let numInstance = 0;
  let sawH1 = false;
  let jobParas = []; // paragraphs of the current job block (to set keepNext)
  const endJob = () => { for (let k = 0; k < jobParas.length - 1; k++) jobParas[k]._keepNext = true; jobParas = []; };
  const pushPara = (p) => { children.push(p); if (jobParas.length) jobParas.push(p); return p; };

  const emitList = (list, level = 0) => {
    if (list.ordered) numInstance++;
    const inst = numInstance;
    for (const it of list.items) {
      const p = { numbering: { reference: list.ordered ? 'numbers' : 'bullets', level: Math.min(level, 2), instance: list.ordered ? inst : undefined }, children: runs(it.inlines), spacing: { after: pt(1.8), line: 264 }, keepLines: true };
      pushPara(p);
      for (const sub of it.children) emitList(sub, level + 1);
    }
  };

  const emitBlocks = (bs, ctx = {}) => {
    bs.forEach((b, idx) => {
      if (b.type === 'heading' || b.type === 'hr') endJob();
      switch (b.type) {
        case 'heading': {
          const lvl = Math.min(b.level, 4);
          const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][lvl - 1];
          const p = { heading, children: runs(b.inlines), keepNext: true, keepLines: true };
          if (lvl === 1 && !sawH1) { sawH1 = true; if (bs[idx + 1]?.type === 'paragraph') bs[idx + 1]._contact = true; }
          if (lvl === 3 && kind === 'resume') { children.push(p); jobParas = [p]; } else pushPara(p);
          break;
        }
        case 'paragraph': {
          const p = { children: runs(b.inlines), keepLines: true, spacing: letter ? { after: pt(9), line: 300 } : { after: pt(4), line: 264 } };
          if (b._contact) { p.style = 'Contact'; }
          if (ctx.quote) { p.indent = { left: pt(18) }; p.children = runs(b.inlines, { italic: true }); }
          pushPara(p); break;
        }
        case 'list': emitList(b); break;
        case 'hr': children.push({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, spacing: { before: pt(2), after: pt(8) } }); break;
        case 'quote': emitBlocks(b.blocks, { quote: true }); break;
        case 'code': for (const line of b.text.split('\n')) pushPara({ children: [new TextRun({ text: line, font: 'Courier New', size: 18 })], spacing: { after: 0 } }); break;
        case 'table': {
          const cell = (inl, header) => new TableCell({ children: [new Paragraph({ children: runs(inl, { bold: header }), spacing: { after: 0 } })] });
          const rows = [new TableRow({ tableHeader: true, children: b.header.map((c) => cell(c, true)) }), ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))];
          endJob();
          children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
          children.push({ children: [], spacing: { after: pt(4) } });
          break;
        }
      }
    });
  };
  emitBlocks(blocks);
  endJob();

  const body = children.map((c) => { if (c instanceof Table) return c; const { _keepNext, ...rest } = c; return new Paragraph({ ...rest, keepNext: rest.keepNext || _keepNext || undefined }); });

  const doc = new Document({
    creator: title || 'Career OS', title: title || 'Document', description: 'Rendered by career-os tools/render.mjs',
    styles: {
      default: { document: { run: { font: 'Arial', size: base, color: '111111' }, paragraph: { spacing: { after: pt(4), line: 264 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: letter ? 36 : 40, bold: true, color: '000000' }, paragraph: { spacing: { before: 0, after: pt(2) }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: base, bold: true, smallCaps: true, characterSpacing: 22, color: '000000' }, paragraph: { spacing: { before: pt(11), after: pt(4) }, keepNext: true, outlineLevel: 1, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333', space: 1 } } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: base, bold: true, color: '000000' }, paragraph: { spacing: { before: pt(7), after: pt(1.5) }, keepNext: true, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Arial', size: base, bold: true, italics: true, color: '000000' }, paragraph: { spacing: { before: pt(5), after: pt(1) }, keepNext: true, outlineLevel: 3 } },
        { id: 'Contact', name: 'Contact', basedOn: 'Normal', next: 'Normal', run: { font: 'Arial', size: base - 2, color: '333333' }, paragraph: { spacing: { after: pt(letter ? 14 : 9) } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: ['•', '–', '·'][l], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 340 + 340 * l, hanging: 240 } } } })) },
        { reference: 'numbers', levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 340 + 340 * l, hanging: 260 } } } })) },
      ],
    },
    sections: [{
      properties: { page: { size: { width: mm(210), height: mm(297) }, margin: { top: mm(14), bottom: mm(14), left: mm(15), right: mm(15) } } },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}

// ───────────────────────────── HTML → PDF (headless Chrome) ─────────────────────────────
function findChrome(explicit) {
  const list = explicit ? [explicit, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  const found = list.find((p) => p && existsSync(p));
  if (!found) throw new Error(`No Chrome/Chromium found. Tried: ${list.join(', ')} — pass --chrome <path> or set CHROME=`);
  return found;
}

/** true when the file ends with a PDF trailer (%%EOF), i.e. Chrome has finished writing it. */
function pdfComplete(file) {
  try {
    const size = statSync(file).size; if (size < 32) return false;
    const fd = openSync(file, 'r'); const buf = Buffer.alloc(Math.min(1024, size));
    readSync(fd, buf, 0, buf.length, size - buf.length); closeSync(fd);
    return buf.toString('latin1').includes('%%EOF');
  } catch { return false; }
}

export async function htmlToPdf(htmlPath, pdfPath, { chrome, verbose = false } = {}) {
  await rm(pdfPath, { force: true });
  const bin = findChrome(chrome);
  const args = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href];
  if (verbose) console.error(`  chrome: ${bin} ${args.join(' ')}`);
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    let done = false; let lastSize = -1; let stable = 0;
    const finish = (err) => { if (done) return; done = true; clearInterval(poll); clearTimeout(hard); err ? reject(err) : resolve(); };
    const havePdf = () => { try { return statSync(pdfPath).size > 0 && pdfComplete(pdfPath); } catch { return false; } };
    child.on('error', (e) => finish(new Error(`Could not start Chrome: ${e.message}`)));
    child.on('exit', (code, sig) => finish(havePdf() ? null : new Error(`Chrome exited (${code ?? sig}) without writing ${pdfPath}\n${stderr.slice(-600)}`)));
    // Watchdog: once the PDF has stopped growing for ~2 s, Chrome has finished — kill it if it lingers (see header note).
    const poll = setInterval(() => {
      try { const s = statSync(pdfPath).size; if (s > 0 && s === lastSize) { if (++stable >= 4 && pdfComplete(pdfPath)) child.kill('SIGKILL'); } else { stable = 0; lastSize = s; } } catch { /* not yet */ }
    }, 500);
    const hard = setTimeout(() => { child.kill('SIGKILL'); finish(havePdf() ? null : new Error(`Chrome timed out after 90 s\n${stderr.slice(-600)}`)); }, 90000);
  });
  if (verbose && stderr.trim()) console.error(stderr.trim().split('\n').map((l) => '  chrome> ' + l).join('\n'));
}

// ───────────────────────────── verification + merge (python3 + pypdf) ─────────────────────────────
async function py(code, args = []) {
  try {
    const { stdout } = await execFileP('python3', ['-c', code, ...args], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(`python3 failed: ${(e.stderr || e.message).toString().trim().split('\n').slice(-3).join(' | ')}`);
  }
}

export async function pdfInfo(pdfPath) {
  const out = await py(`
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
t = "\\n".join((p.extract_text() or "") for p in r.pages)
print(json.dumps({"pages": len(r.pages), "chars": len(t.strip()), "sample": " ".join(t.split())[:140]}))`, [pdfPath]);
  return JSON.parse(out);
}

export async function docxInfo(docxPath) {
  const out = await py(`
import sys, json, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip(); names = z.namelist()
ok = bad is None and "word/document.xml" in names and "[Content_Types].xml" in names
doc = z.read("word/document.xml").decode("utf8") if ok else ""
text = re.sub(r"<[^>]+>", " ", re.sub(r"</w:p>", "\\n", doc))
print(json.dumps({"ok": ok, "corrupt": bad, "files": len(names), "paragraphs": doc.count("<w:p>") + doc.count("<w:p "), "chars": len(" ".join(text.split())), "sample": " ".join(text.split())[:140]}))`, [docxPath]);
  return JSON.parse(out);
}

export async function mergePdfs(inputs, outPath) {
  const out = await py(`
import sys
from pypdf import PdfWriter, PdfReader
w = PdfWriter()
for f in sys.argv[2:]:
    w.append(PdfReader(f))
with open(sys.argv[1], "wb") as fh:
    w.write(fh)
print(len(w.pages))`, [outPath, ...inputs]);
  return Number(out.trim());
}

// ───────────────────────────── folder + naming ─────────────────────────────
function resolveFolder(arg) {
  if (arg === 'profile') return { dir: path.join(ROOT, 'profile'), resume: path.join(ROOT, 'profile', 'master-resume.md'), cover: null, outDir: path.join(ROOT, 'profile', 'outputs'), isProfile: true };
  const candidates = [path.isAbsolute(arg) ? arg : null, path.resolve(ROOT, arg), path.resolve(process.cwd(), arg), path.join(ROOT, 'jobs', arg)].filter(Boolean);
  const dir = candidates.find((c) => existsSync(c) && statSync(c).isDirectory());
  if (!dir) throw new Error(`Folder not found: ${arg} (tried ${candidates.join(', ')})`);
  const resume = path.join(dir, 'resume.md');
  const cover = path.join(dir, 'cover-letter.md');
  return { dir, resume, cover: existsSync(cover) ? cover : null, outDir: path.join(dir, 'outputs'), isProfile: false };
}

const safeName = (s) => String(s).replace(/\.(pdf|docx|html?)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Resume';

async function guessCompany(dir) {
  // 1) jd.md's H1 is "<Title> — <Company>" by convention; 2) fall back to the slug's first token.
  try {
    const jd = await readFile(path.join(dir, 'jd.md'), 'utf8');
    const h1 = jd.split('\n').find((l) => /^#\s+/.test(l));
    if (h1) {
      const parts = h1.replace(/^#\s+/, '').split(/\s+[—–-]\s+/);
      if (parts.length > 1) { const c = parts[parts.length - 1].trim().replace(/[^A-Za-z0-9]+/g, ''); if (c) return c; }
    }
  } catch { /* no jd.md */ }
  const first = path.basename(dir).split('-')[0] || 'Company';
  return first.length <= 4 ? first.toUpperCase() : first[0].toUpperCase() + first.slice(1);
}

// ───────────────────────────── main ─────────────────────────────
async function renderDoc({ mdPath, kind, baseName, outDir, title }) {
  const md = await readFile(mdPath, 'utf8');
  const { html, blocks } = markdownToHtml(md, { kind, title, compact: !!opts.compact && kind === 'resume' });
  const htmlPath = path.join(outDir, `${baseName}.html`);
  const pdfPath = path.join(outDir, `${baseName}.pdf`);
  const docxPath = path.join(outDir, `${baseName}.docx`);
  await writeFile(htmlPath, html, 'utf8');
  const result = { kind, md: mdPath, html: htmlPath, pdf: null, docx: null, pages: null, pdfChars: null, docxOk: null, docxChars: null, problems: [] };
  if (opts.pdf) {
    await htmlToPdf(htmlPath, pdfPath, { chrome: opts.chrome, verbose: opts.verbose });
    const info = await pdfInfo(pdfPath);
    result.pdf = pdfPath; result.pages = info.pages; result.pdfChars = info.chars; result.pdfSample = info.sample;
    if (!info.chars) result.problems.push('PDF has no extractable text');
    if (kind === 'resume' && !opts.folderIsProfile && info.pages > 2) result.problems.push(`resume is ${info.pages} pages (aim for 1–2)`);
  }
  if (opts.docx) {
    const buf = await blocksToDocx(blocks, { kind, title });
    await writeFile(docxPath, buf);
    const info = await docxInfo(docxPath);
    result.docx = docxPath; result.docxOk = info.ok; result.docxChars = info.chars; result.docxParas = info.paragraphs; result.docxSample = info.sample;
    if (!info.ok) result.problems.push(`DOCX is not a valid package (${info.corrupt || 'missing word/document.xml'})`);
    else if (!info.chars) result.problems.push('DOCX contains no text');
  }
  return result;
}

async function main() {
  const f = resolveFolder(opts.folder);
  opts.folderIsProfile = f.isProfile;
  if (!existsSync(f.resume)) {
    const have = existsSync(f.dir) ? (await readdir(f.dir)).join(', ') : '(missing)';
    throw new Error(`No resume.md in ${f.dir} (folder has: ${have}). Write jobs/<slug>/resume.md first (see /tailor).`);
  }
  opts.merge = opts.merge.map((m) => [path.resolve(m), path.resolve(ROOT, m)].find((c) => existsSync(c)) || (() => { throw new Error(`--merge file not found: ${m}`); })());
  await mkdir(f.outDir, { recursive: true });

  const company = f.isProfile ? 'Master_PREVIEW' : await guessCompany(f.dir);
  const resumeName = safeName(opts.name || `Resume_LeoLong_${company}`);
  const coverName = /^Resume/i.test(resumeName) ? resumeName.replace(/^Resume/i, 'CoverLetter') : `CoverLetter_${resumeName}`;
  const combinedName = /^Resume/i.test(resumeName) ? resumeName.replace(/^Resume/i, 'Application') : `${resumeName}_Combined`;
  const title = (md.match(/^#\s+(.+)$/m) || [, 'Resume'])[1].trim();

  const relDir = (p) => { const r = path.relative(ROOT, p); return r.startsWith('..') ? p : r || '.'; };
  console.error(`[render] ${relDir(f.dir)} → ${relDir(f.outDir)}  (name: ${resumeName})`);
  const results = [];
  results.push(await renderDoc({ mdPath: f.resume, kind: 'resume', baseName: resumeName, outDir: f.outDir, title }));
  if (f.cover) results.push(await renderDoc({ mdPath: f.cover, kind: 'letter', baseName: coverName, outDir: f.outDir, title }));

  let combined = null;
  if ((opts.merge.length || opts.combine) && opts.pdf) {
    const parts = [...results.map((r) => r.pdf).filter(Boolean), ...opts.merge];
    const outPath = path.join(f.outDir, `${combinedName}.pdf`);
    const pages = await mergePdfs(parts, outPath);
    const info = await pdfInfo(outPath);
    combined = { pdf: outPath, pages, chars: info.chars, parts };
  }

  // ── report ──
  const rel = (p) => { const r = path.relative(ROOT, p); return r.startsWith('..') ? p : r; };
  let bad = 0;
  for (const r of results) {
    console.log(`\n${r.kind === 'resume' ? 'Resume' : 'Cover letter'}  ← ${rel(r.md)}`);
    console.log(`  html  ${rel(r.html)}`);
    if (r.pdf) console.log(`  pdf   ${rel(r.pdf)}  pages=${r.pages}  text=${r.pdfChars} chars  "${r.pdfSample}"`);
    if (r.docx) console.log(`  docx  ${rel(r.docx)}  valid=${r.docxOk}  paragraphs=${r.docxParas}  text=${r.docxChars} chars`);
    for (const p of r.problems) { console.log(`  !! ${p}`); if (!/aim for/.test(p)) bad++; }
  }
  if (combined) {
    console.log(`\nCombined PDF  ${rel(combined.pdf)}  pages=${combined.pages}  text=${combined.chars} chars`);
    console.log(`  parts: ${combined.parts.map((p) => rel(p)).join(' + ')}`);
  }
  if (bad) { console.error(`\n[render] ${bad} problem(s) — see above`); process.exit(1); }
}

if (IS_CLI) main().catch((e) => { console.error(`[render] ERROR: ${e.message}`); if (opts.verbose && e.stack) console.error(e.stack); process.exit(1); });
