import { promises as fsp, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { BACKUP_DIR } from '../lib/config';
import { renderDetectionReport, renderMatrixPdf, renderPagePdf, type PdfPage, type PdfRule } from './pdf/reports';
import { TACTICS } from '../lib/attack';
import {
  LANGUAGE_LABELS,
  PAGE_TYPE_LABELS,
  SEVERITIES,
  SOURCE_LABELS,
  STATUSES,
  cap,
  coveredTechniques,
  description,
  referenceItems,
  tacticNames,
  techniqueLines,
} from './report-content';

const DOCS_DIR = join(BACKUP_DIR, 'docs');

async function ensureDir(filePath: string) {
  await fsp.mkdir(dirname(filePath), { recursive: true });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m] || m));
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60);
}

// Convert inline markdown to HTML after escaping HTML special chars
function inlineMarkdown(raw: string): string {
  let s = escapeHtml(raw);
  // Protect inline code from further processing
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\x00C${codes.length - 1}\x00`; });
  s = s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Only http(s) and in-page links: a javascript: URL would run when the report is opened
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => (/^(https?:\/\/|#)/i.test(url.trim()) ? `<a href="${url}">${text}</a>` : text))
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link">$1</span>');
  s = s.replace(/\x00C(\d+)\x00/g, (_, i) => `<code>${codes[parseInt(i)]}</code>`);
  return s;
}

// Convert markdown to HTML (block + inline elements)
function mdToHtml(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuffer = '';
  let inUl = false;
  let inOl = false;
  let blankCount = 0;

  const closeList = () => {
    if (inUl) { html += '</ul>\n'; inUl = false; }
    if (inOl) { html += '</ol>\n'; inOl = false; }
  };

  for (const line of lines) {
    // Code block toggle
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch && !inCodeBlock) {
      closeList();
      inCodeBlock = true;
      codeLang = fenceMatch[1] || '';
      codeBuffer = '';
      blankCount = 0;
      continue;
    }
    if (inCodeBlock) {
      if (line.startsWith('```')) {
        const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
        html += `<pre><code${langAttr}>${escapeHtml(codeBuffer.replace(/\n$/, ''))}</code></pre>\n`;
        inCodeBlock = false;
        codeBuffer = '';
      } else {
        codeBuffer += line + '\n';
      }
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      blankCount++;
      closeList();
      continue;
    }
    blankCount = 0;

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inlineMarkdown(h[2])}</h${level}>\n`;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      closeList();
      html += '<hr>\n';
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      html += `<blockquote><p>${inlineMarkdown(line.slice(2))}</p></blockquote>\n`;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (inOl) { html += '</ol>\n'; inOl = false; }
      if (!inUl) { html += '<ul>\n'; inUl = true; }
      html += `<li>${inlineMarkdown(ulMatch[1])}</li>\n`;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (inUl) { html += '</ul>\n'; inUl = false; }
      if (!inOl) { html += '<ol>\n'; inOl = true; }
      html += `<li>${inlineMarkdown(olMatch[1])}</li>\n`;
      continue;
    }

    // Table (simple detection: contains |)
    if (line.includes('|') && line.trim().startsWith('|')) {
      closeList();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|');
      // Check if this is a separator row
      if (cells.every((c) => /^[-: ]+$/.test(c))) {
        continue; // skip separator
      }
      const tag = html.endsWith('</thead>\n') ? 'td' : 'td';
      const isHeader = !html.includes('<tbody>') && html.includes('<table>') && !html.includes('<tr>');
      const cellTag = isHeader ? 'th' : 'td';
      html += `<tr>${cells.map((c) => `<${cellTag}>${inlineMarkdown(c.trim())}</${cellTag}>`).join('')}</tr>\n`;
      if (!html.includes('<table>')) {
        html = html.replace(/<tr>/, '<table><thead><tr>').replace(/<\/tr>\n$/, '</tr></thead><tbody>\n');
      }
      continue;
    }
    if (html.includes('<table>') && !html.includes('</table>')) {
      html += '</tbody></table>\n';
    }

    // Regular paragraph
    closeList();
    html += `<p>${inlineMarkdown(line)}</p>\n`;
  }

  closeList();
  if (inCodeBlock) {
    html += `<pre><code>${escapeHtml(codeBuffer)}</code></pre>\n`;
  }

  return html;
}

/** Vazirmatn embedded, so Persian text renders the same everywhere (the report is one offline file). */
function embeddedFonts(): string {
  try {
    const dir = join(dirname(require.resolve('vazirmatn/package.json')), 'fonts', 'webfonts');
    const face = (file: string, weight: number) =>
      `@font-face { font-family: 'Vazirmatn'; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${readFileSync(join(dir, file)).toString('base64')}) format('woff2'); }`;
    return face('Vazirmatn-Regular.woff2', 400) + face('Vazirmatn-Bold.woff2', 700);
  } catch {
    return '';
  }
}

function htmlStyles(): string {
  return `
    ${embeddedFonts()}
    :root { --ink: #111827; --text: #1f2937; --muted: #6b7280; --rule: #e5e7eb; --brand: #312e81; --brand-dark: #1e1b4b; --brand-soft: #eef2ff; --code: #f6f7f9; --link: #1d4ed8; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Vazirmatn', -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.65; color: var(--text); background: #f3f4f6; }
    main { max-width: 920px; margin: 0 auto; padding: 0 24px 64px; }
    a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
    p, li, td, th, h1, h2, h3, h4, blockquote { unicode-bidi: plaintext; }
    .cover { background: var(--brand-dark); color: #fff; padding: 56px 0 0; }
    .cover .inner { max-width: 920px; margin: 0 auto; padding: 0 24px; }
    .cover .bar { width: 46px; height: 4px; background: #a5b4fc; margin-bottom: 18px; }
    .cover h1 { font-size: 34px; line-height: 1.25; font-weight: 700; color: #fff; }
    .cover .sub { color: #c7d2fe; margin-top: 8px; }
    .tiles { display: flex; gap: 12px; flex-wrap: wrap; background: var(--brand); margin-top: 40px; padding: 28px 0; }
    .tiles .inner { display: flex; gap: 12px; flex-wrap: wrap; }
    .tile { flex: 1 1 150px; background: rgba(255,255,255,.08); border-radius: 8px; padding: 14px 16px; }
    .tile b { display: block; font-size: 26px; line-height: 1.2; }
    .tile span { color: #c7d2fe; font-size: 12px; }
    section { background: #fff; border: 1px solid var(--rule); border-radius: 10px; padding: 28px 32px; margin-top: 24px; }
    h2.section { font-size: 22px; color: var(--brand-dark); margin-bottom: 18px; }
    h2.section::after { content: ''; display: block; width: 40px; height: 3px; background: var(--brand); margin-top: 8px; }
    .label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 18px 0 6px; }
    .bars { display: grid; grid-template-columns: 150px 1fr 40px; gap: 6px 12px; align-items: center; font-size: 13px; }
    .bars .track { background: #f1f5f9; border-radius: 4px; height: 8px; } .bars .fill { height: 8px; border-radius: 4px; }
    .bars .n { text-align: right; font-weight: 700; color: var(--ink); }
    .toc ol { list-style: none; } .toc li { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e2e8f0; }
    .toc .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .toc .group { font-weight: 700; color: var(--brand-dark); margin: 14px 0 4px; }
    .rule { border-top: 1px solid var(--rule); padding-top: 22px; margin-top: 22px; } .rule:first-of-type { border: 0; padding-top: 0; margin-top: 0; }
    .rule h3, .page h3 { font-size: 18px; color: var(--ink); line-height: 1.35; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
    .badge { font-size: 11px; font-weight: 700; padding: 1px 10px; border-radius: 999px; border: 1px solid currentColor; }
    .badge.solid { color: #fff !important; border-color: transparent; }
    dl.meta { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; font-size: 13.5px; }
    dl.meta dt { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding-top: 2px; }
    dl.meta dd { white-space: pre-line; }
    pre { background: var(--code); border-left: 3px solid var(--brand); border-radius: 4px; padding: 10px 14px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; color: var(--ink); }
    code { font-family: 'SFMono-Regular', Consolas, monospace; background: var(--code); padding: 0 4px; border-radius: 3px; font-size: .9em; }
    pre code { background: none; padding: 0; }
    .md p { margin-bottom: 8px; } .md ul, .md ol { padding-inline-start: 22px; margin-bottom: 8px; } .md h1, .md h2, .md h3, .md h4 { font-size: 15px; margin: 14px 0 6px; color: var(--ink); }
    .md table, table.grid { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 13px; }
    .md th, .md td { border-bottom: 1px solid var(--rule); padding: 6px 8px; text-align: start; } .md th { background: var(--brand-soft); color: var(--brand-dark); }
    .md blockquote { border-inline-start: 3px solid var(--rule); padding-inline-start: 12px; color: var(--muted); }
    .wiki-link { color: var(--brand); }
    ul.refs { list-style: none; font-size: 13px; } ul.refs li { overflow-wrap: anywhere; padding: 1px 0; }
    .page .meta { color: var(--muted); font-size: 12px; margin: 2px 0 12px; }
    footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 32px; }
    @media print {
      body { background: #fff; } main { padding: 0; } section { border: 0; padding: 0; margin-top: 0; break-before: page; }
      .rule, .page { break-inside: auto; } dl.meta, h3 { break-after: avoid; } .cover { break-after: page; min-height: 100vh; }
    }
  `;
}

export interface DocSplCommand {
  command: string;
  group: string;
  syntax: string;
  description: string;
  examples: string;
  pitfalls?: string | null;
}

export interface DocRuleFull {
  id?: number;
  status?: string;
  severity?: string;
  splQuery?: string;
  mitreTactics?: string;
  mitreTechniques?: string;
  dataSource?: string;
  falsePositives?: string;
  references?: string;
  testNotes?: string;
}

export interface DocPage {
  id: number;
  title: string;
  slug: string;
  contentMd: string;
  type: string;
  tags?: { tag: { name: string; color?: string } }[];
  createdAt?: string | Date;
  splCommand?: DocSplCommand | null;
  rule?: DocRuleFull | null;
}

export interface DocRule {
  id: number;
  page: { title: string; contentMd?: string | null; tags?: { tag: { name: string } }[] };
  sourceFormat?: string | null;
  severity?: string;
  status?: string;
  splQuery?: string;
  /** Imported rules' own query (KQL, EQL, ES|QL…) */
  nativeQuery?: string | null;
  nativeLanguage?: string | null;
  mitreTactics?: string;
  mitreTechniques?: string;
  dataSource?: string;
  falsePositives?: string;
  references?: string;
  testNotes?: string;
}



/** Paragraph-level elements pick their direction from their text (Persian notes read right to left). */
const autoDir = (html: string) => html.replace(/<(p|li|h[1-6]|td|th|blockquote)(?=[\s>])/g, '<$1 dir="auto"');

const SEVERITY_HEX: Record<string, string> = { critical: '#b91c1c', high: '#ea580c', medium: '#d97706', low: '#2563eb', info: '#64748b' };
const STATUS_HEX: Record<string, string> = { production: '#15803d', testing: '#b45309', draft: '#475569', deprecated: '#b91c1c' };

function barsHtml(rows: { label: string; count: number; color: string }[], total: number): string {
  return `<div class="bars">${rows
    .map(
      (r) =>
        `<div>${escapeHtml(r.label)}</div><div class="track"><div class="fill" style="width:${Math.max(2, (r.count / Math.max(total, 1)) * 100)}%;background:${r.color}"></div></div><div class="n">${r.count}</div>`
    )
    .join('')}</div>`;
}

function ruleHtml(r: DocRule, i: number): string {
  const sev = r.severity ?? '';
  const badges = [
    sev && `<span class="badge solid" style="background:${SEVERITY_HEX[sev] ?? '#6b7280'}">${escapeHtml(sev.toUpperCase())}</span>`,
    r.status && `<span class="badge" style="color:${STATUS_HEX[r.status] ?? '#6b7280'}">${escapeHtml(cap(r.status))}</span>`,
    `<span class="badge" style="color:#6b7280">${escapeHtml(r.sourceFormat ? SOURCE_LABELS[r.sourceFormat] ?? r.sourceFormat : 'Written in DetectKB')}</span>`,
  ].filter(Boolean);
  const meta: [string, string][] = [
    ['Tactics', tacticNames(r).join('\n')],
    ['Techniques', techniqueLines(r.mitreTechniques).join('\n')],
    ['Data source', r.dataSource ?? ''],
    ['Tags', r.page.tags?.map((t) => t.tag.name).join(', ') ?? ''],
  ];
  const desc = description(r.page.contentMd);
  const query = (label: string, q?: string | null) => (q?.trim() ? `<div class="label">${escapeHtml(label)}</div><pre><code>${escapeHtml(q)}</code></pre>` : '');
  const md = (label: string, text?: string | null) => (text?.trim() ? `<div class="label">${label}</div><div class="md">${autoDir(mdToHtml(text))}</div>` : '');
  const refs = r.references?.trim()
    ? `<div class="label">References</div><ul class="refs">${referenceItems(r.references)
        .map((it) => `<li>${it.link ? `<a href="${escapeHtml(it.link)}">${escapeHtml(it.text)}</a>` : escapeHtml(it.text)}</li>`)
        .join('')}</ul>`
    : '';
  return `
    <article class="rule" id="rule-${r.id}">
      <h3 dir="auto">${i + 1}. ${escapeHtml(r.page.title)}</h3>
      <div class="badges">${badges.join('')}</div>
      <dl class="meta">${meta
        .filter(([, v]) => v)
        .map(([k, v]) => `<dt>${k}</dt><dd dir="auto">${escapeHtml(v)}</dd>`)
        .join('')}</dl>
      ${desc ? `<div class="label">Description</div><div class="md">${autoDir(mdToHtml(desc))}</div>` : ''}
      ${query('SPL query', r.splQuery)}
      ${query(`${LANGUAGE_LABELS[r.nativeLanguage ?? ''] ?? r.nativeLanguage ?? 'Native'} query`, r.nativeQuery)}
      ${md('False positives', r.falsePositives)}
      ${md('Test notes', r.testNotes)}
      ${refs}
    </article>`;
}

export async function generateHTMLReport(
  title: string,
  pages: DocPage[],
  rules: DocRule[],
  opts?: { includeTableOfContents?: boolean }
): Promise<string> {
  const toc = opts?.includeTableOfContents !== false;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const tiles: [string, number][] = [];
  if (rules.length) {
    tiles.push(['Detection rules', rules.length], ['ATT&CK techniques', coveredTechniques(rules).size], ['In production', rules.filter((r) => r.status === 'production').length]);
  }
  if (pages.length) tiles.push(['Knowledge pages', pages.length]);

  let summary = '';
  if (rules.length) {
    const count = (f: (r: DocRule) => boolean) => rules.filter(f).length;
    const bySeverity = SEVERITIES.map((s) => ({ label: cap(s), count: count((r) => r.severity === s), color: SEVERITY_HEX[s] })).filter((r) => r.count);
    const byStatus = STATUSES.map((s) => ({ label: cap(s), count: count((r) => r.status === s), color: STATUS_HEX[s] })).filter((r) => r.count);
    const byTactic = TACTICS.map((t) => ({ label: t.name, count: count((r) => tacticNames(r).some((n) => n.endsWith(`(${t.id})`))), color: '#312e81' })).filter((r) => r.count);
    summary = `<section><h2 class="section">Summary</h2>
      <div class="label">By severity</div>${barsHtml(bySeverity, rules.length)}
      <div class="label">By status</div>${barsHtml(byStatus, rules.length)}
      ${byTactic.length ? `<div class="label">By ATT&amp;CK tactic</div>${barsHtml(byTactic, rules.length)}` : ''}
    </section>`;
  }

  let tocHtml = '';
  if (toc && rules.length + pages.length > 1) {
    tocHtml = `<section class="toc"><h2 class="section">Contents</h2>
      ${rules.length ? `<div class="group"><a href="#rules">Detection rules</a></div><ol>${rules
        .map((r) => `<li dir="auto"><span class="dot" style="background:${SEVERITY_HEX[r.severity ?? ''] ?? '#cbd5e1'}"></span><a href="#rule-${r.id}">${escapeHtml(r.page.title)}</a></li>`)
        .join('')}</ol>` : ''}
      ${pages.length ? `<div class="group"><a href="#pages">Knowledge pages</a></div><ol>${pages.map((p) => `<li dir="auto"><a href="#page-${p.id}">${escapeHtml(p.title)}</a></li>`).join('')}</ol>` : ''}
    </section>`;
  }

  const rulesHtml = rules.length ? `<section id="rules"><h2 class="section">Detection rules</h2>${rules.map(ruleHtml).join('')}</section>` : '';
  const pagesHtml = pages.length
    ? `<section id="pages"><h2 class="section">Knowledge pages</h2>${pages
        .map(
          (p) => `<article class="page rule" id="page-${p.id}">
            <h3 dir="auto">${escapeHtml(p.title)}</h3>
            <div class="meta" dir="auto">${escapeHtml([PAGE_TYPE_LABELS[p.type] ?? p.type, ...(p.tags ?? []).map((t) => `#${t.tag.name}`)].join('   '))}</div>
            <div class="md">${autoDir(mdToHtml(p.contentMd))}</div>
            ${p.splCommand ? renderSplCommandHtml(p.splCommand) : ''}
          </article>`
        )
        .join('')}</section>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${htmlStyles()}</style>
</head>
<body>
  <header class="cover">
    <div class="inner">
      <div class="bar"></div>
      <h1 dir="auto">${escapeHtml(title)}</h1>
      <div class="sub">${rules.length ? 'Detection rules and coverage' : 'Knowledge base pages'} · ${date}</div>
    </div>
    ${tiles.length ? `<div class="tiles"><div class="inner" style="width:100%">${tiles.map(([l, n]) => `<div class="tile"><b>${n}</b><span>${escapeHtml(l)}</span></div>`).join('')}</div></div>` : ''}
  </header>
  <main>
    ${summary}
    ${tocHtml}
    ${rulesHtml}
    ${pagesHtml}
    <footer>Generated by DetectKB on ${date}</footer>
  </main>
</body>
</html>`;

  const filename = `${sanitizeFilename(title)}_${Date.now()}.html`;
  const filePath = join(DOCS_DIR, filename);
  await ensureDir(filePath);
  await fsp.writeFile(filePath, html, 'utf-8');
  return filePath;
}

function renderSplCommandHtml(spl: DocSplCommand): string {
  return `
    <div class="badges"><span class="badge solid" style="background:#92400e">SPL · ${escapeHtml(spl.group)}</span></div>
    <div class="label">Syntax</div><pre><code>${escapeHtml(spl.syntax)}</code></pre>
    ${spl.description ? `<div class="label">Description</div><div class="md">${autoDir(mdToHtml(spl.description))}</div>` : ''}
    ${spl.examples ? `<div class="label">Examples</div><pre><code>${escapeHtml(spl.examples)}</code></pre>` : ''}
    ${spl.pitfalls ? `<div class="label">Pitfalls</div><div class="md">${autoDir(mdToHtml(spl.pitfalls))}</div>` : ''}`;
}

export async function generatePDFReport(title: string, pages: DocPage[], rules: DocRule[]): Promise<string> {
  const filePath = join(DOCS_DIR, `${sanitizeFilename(title)}_${Date.now()}.pdf`);
  await ensureDir(filePath);
  return renderDetectionReport(filePath, title, pages as PdfPage[], rules as PdfRule[]);
}

export async function exportSinglePagePDF(page: DocPage): Promise<string> {
  const filePath = join(DOCS_DIR, `${sanitizeFilename(page.title)}_${Date.now()}.pdf`);
  await ensureDir(filePath);
  return renderPagePdf(filePath, page as PdfPage);
}

export async function exportDetectionMatrix(rules: DocRule[], title = 'Detection Matrix'): Promise<string> {
  const filePath = join(DOCS_DIR, `${sanitizeFilename(title)}_${Date.now()}.pdf`);
  await ensureDir(filePath);
  return renderMatrixPdf(filePath, title, rules);
}

export async function getFileSize(filePath: string): Promise<number> {
  const stat = await fsp.stat(filePath);
  return stat.size;
}
