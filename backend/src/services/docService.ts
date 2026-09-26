import PDFDocument from 'pdfkit';
import { createWriteStream, promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { BACKUP_DIR } from '../lib/config';

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
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
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

// Strip all markdown to plain text (for PDF where we can't render HTML)
function mdToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/^#{1,6} (.*)$/gm, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\. /gm, '')
    .replace(/^> /gm, '');
}

function htmlStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937; background: #fff; padding: 2.5rem; max-width: 900px; margin: 0 auto; }
    .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 55vh; background: linear-gradient(135deg, #4f46e5, #1e1b4b); color: white; text-align: center; padding: 3rem; border-radius: 12px; margin-bottom: 3rem; page-break-after: always; }
    .cover h1 { font-size: 2.5rem; margin-bottom: 1rem; font-weight: 700; }
    .cover p { font-size: 1rem; opacity: 0.85; margin: 0.25rem 0; }
    h1 { font-size: 1.8rem; color: #1e1b4b; margin: 2.5rem 0 0.75rem; font-weight: 700; }
    h2 { font-size: 1.4rem; color: #312e81; margin: 2rem 0 0.5rem; font-weight: 600; border-bottom: 2px solid #e0e7ff; padding-bottom: 0.4rem; }
    h3 { font-size: 1.15rem; color: #3730a3; margin: 1.5rem 0 0.3rem; font-weight: 600; }
    h4, h5, h6 { font-size: 1rem; color: #374151; margin: 1rem 0 0.25rem; font-weight: 600; }
    p { margin-bottom: 0.85rem; }
    ul, ol { padding-left: 1.75rem; margin-bottom: 1rem; }
    li { margin-bottom: 0.3rem; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
    blockquote { border-left: 4px solid #6366f1; padding: 0.5rem 1rem; background: #f5f3ff; border-radius: 0 6px 6px 0; margin: 1rem 0; color: #4b5563; }
    pre { background: #1e1b4b; color: #e0e7ff; padding: 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; font-size: 0.82rem; line-height: 1.6; }
    code { font-family: 'Courier New', Consolas, monospace; background: #ede9fe; color: #4c1d95; padding: 0.15em 0.45em; border-radius: 4px; font-size: 0.88em; }
    pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
    a { color: #4f46e5; }
    .wiki-link { color: #6366f1; font-style: italic; }
    .rule-card { border-left: 4px solid #4f46e5; padding: 1.25rem 1.5rem; margin: 1.75rem 0; background: #f5f3ff; border-radius: 0 8px 8px 0; page-break-inside: avoid; }
    .spl-card { border-left: 4px solid #f59e0b; padding: 1.25rem 1.5rem; margin: 1.75rem 0; background: #fffbeb; border-radius: 0 8px 8px 0; page-break-inside: avoid; }
    .rule-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 0.75rem 0; font-size: 0.9rem; color: #6b7280; }
    .rule-meta > div { background: #fff; padding: 0.35rem 0.6rem; border-radius: 4px; border: 1px solid #e5e7eb; }
    .severity-critical { color: #dc2626; font-weight: 700; }
    .severity-high { color: #ea580c; font-weight: 700; }
    .severity-medium { color: #d97706; font-weight: 700; }
    .severity-low { color: #059669; font-weight: 700; }
    .tag { display: inline-block; padding: 0.2em 0.65em; border-radius: 9999px; font-size: 0.72rem; color: white; margin: 0.15em; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
    th { background: #ede9fe; color: #312e81; padding: 0.6rem 1rem; border: 1px solid #c7d2fe; font-weight: 600; text-align: left; }
    td { padding: 0.55rem 1rem; border: 1px solid #e5e7eb; }
    tr:nth-child(even) td { background: #f9fafb; }
    .toc { background: #f5f3ff; border: 1px solid #c7d2fe; padding: 1.5rem 2rem; border-radius: 8px; margin-bottom: 2rem; }
    .toc ol { padding-left: 1.5rem; }
    .toc li { margin: 0.35rem 0; color: #4f46e5; }
    .page-section { margin: 2.5rem 0; page-break-inside: avoid; }
    .field-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-top: 0.75rem; margin-bottom: 0.25rem; }
    .field-block { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.6rem 1rem; margin-bottom: 0.5rem; font-size: 0.9rem; }
    @media print { body { padding: 0; } .cover { min-height: 45vh; } }
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
  page: { title: string };
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

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const QUERY_LANGUAGE_LABELS: Record<string, string> = { kql: 'KQL', eql: 'EQL', esql: 'ES|QL', kuery: 'KQL (Kibana)', lucene: 'Lucene' };
const nativeLabel = (r: DocRule) => `${QUERY_LANGUAGE_LABELS[r.nativeLanguage ?? ''] ?? r.nativeLanguage ?? 'Native'} Query`;

export async function generateHTMLReport(
  title: string,
  pages: DocPage[],
  rules: DocRule[],
  opts?: { includeTableOfContents?: boolean }
): Promise<string> {
  const toc = opts?.includeTableOfContents !== false;
  const timestamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let tocHtml = '';
  if (toc && (pages.length + rules.length > 0)) {
    tocHtml = `<div class="toc"><h2 style="margin:0 0 0.75rem;border:none">Table of Contents</h2><ol>`;
    if (pages.length) {
      tocHtml += `<li>Wiki Pages<ol>${pages.map((p) => `<li>${escapeHtml(p.title)}</li>`).join('')}</ol></li>`;
    }
    if (rules.length) {
      tocHtml += `<li>Detection Rules<ol>${rules.map((r) => `<li>${escapeHtml(r.page.title)}</li>`).join('')}</ol></li>`;
    }
    tocHtml += `</ol></div>`;
  }

  let pagesHtml = '';
  if (pages.length) {
    pagesHtml = `<h1>Wiki Pages</h1>`;
    for (const p of pages) {
      const tagBadges = (p.tags || [])
        .map((t) => `<span class="tag" style="background:${escapeHtml(t.tag.color || '#6b7280')}">${escapeHtml(t.tag.name)}</span>`)
        .join('');
      const typeLabel = `<span style="font-size:0.75rem;background:#e0e7ff;color:#3730a3;padding:0.15em 0.6em;border-radius:4px;font-weight:600">${escapeHtml(p.type)}</span>`;
      pagesHtml += `
        <div class="page-section">
          <h2>${escapeHtml(p.title)} ${typeLabel}</h2>
          ${tagBadges ? `<div style="margin-bottom:0.75rem">${tagBadges}</div>` : ''}
          ${mdToHtml(p.contentMd)}
          ${p.splCommand ? renderSplCommandHtml(p.splCommand) : ''}
        </div>`;
    }
  }

  let rulesHtml = '';
  if (rules.length) {
    rulesHtml = `<h1>Detection Rules</h1>`;
    for (const r of rules) {
      const sevClass = `severity-${(r.severity || 'medium').toLowerCase()}`;
      rulesHtml += `
        <div class="rule-card">
          <h3>${escapeHtml(r.page.title)}</h3>
          <div class="rule-meta">
            <div>Severity: <span class="${sevClass}">${escapeHtml(r.severity || 'N/A')}</span></div>
            <div>Status: <strong>${escapeHtml(r.status || 'N/A')}</strong></div>
            ${r.mitreTactics ? `<div>Tactics: ${escapeHtml(r.mitreTactics)}</div>` : ''}
            ${r.mitreTechniques ? `<div>Techniques: ${escapeHtml(r.mitreTechniques)}</div>` : ''}
            ${r.dataSource ? `<div>Data Source: ${escapeHtml(r.dataSource)}</div>` : ''}
          </div>
          ${r.splQuery ? `<div class="field-label">SPL Query</div><pre><code>${escapeHtml(r.splQuery)}</code></pre>` : ''}
          ${r.nativeQuery ? `<div class="field-label">${escapeHtml(nativeLabel(r))}</div><pre><code>${escapeHtml(r.nativeQuery)}</code></pre>` : ''}
          ${r.falsePositives ? `<div class="field-label">False Positives</div><div class="field-block">${escapeHtml(r.falsePositives)}</div>` : ''}
          ${r.references ? `<div class="field-label">References</div><div class="field-block">${mdToHtml(r.references)}</div>` : ''}
          ${r.testNotes ? `<div class="field-label">Test Notes</div><div class="field-block">${mdToHtml(r.testNotes)}</div>` : ''}
        </div>`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${htmlStyles()}</style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(title)}</h1>
    <p>Generated on ${timestamp}</p>
    <p>${plural(pages.length, 'page')} &bull; ${plural(rules.length, 'detection rule')}</p>
  </div>
  ${tocHtml}
  ${pagesHtml}
  ${rulesHtml}
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
    <div class="spl-card">
      <div style="font-weight:700;font-size:1rem;margin-bottom:0.5rem">SPL Command: <code>${escapeHtml(spl.command)}</code></div>
      <div class="rule-meta">
        <div>Group: <strong>${escapeHtml(spl.group)}</strong></div>
      </div>
      <div class="field-label">Syntax</div>
      <pre><code>${escapeHtml(spl.syntax)}</code></pre>
      <div class="field-label">Description</div>
      <div>${mdToHtml(spl.description)}</div>
      ${spl.examples ? `<div class="field-label">Examples</div><pre><code>${escapeHtml(spl.examples)}</code></pre>` : ''}
      ${spl.pitfalls ? `<div class="field-label">Pitfalls</div><div class="field-block">${mdToHtml(spl.pitfalls)}</div>` : ''}
    </div>`;
}

export async function generatePDFReport(
  title: string,
  pages: DocPage[],
  rules: DocRule[]
): Promise<string> {
  const filename = `${sanitizeFilename(title)}_${Date.now()}.pdf`;
  const filePath = join(DOCS_DIR, filename);
  await ensureDir(filePath);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  // Cover
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1e1b4b');
  doc.fill('#ffffff').fontSize(28).font('Helvetica-Bold').text(title, 50, 180, { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(
    `Generated on ${new Date().toLocaleDateString()}`, 50, 240, { align: 'center' }
  );
  doc.fontSize(11).text(`${plural(pages.length, 'page')} · ${plural(rules.length, 'detection rule')}`, 50, 265, { align: 'center' });
  doc.addPage();

  // Table of contents
  doc.fill('#000000').fontSize(18).font('Helvetica-Bold').text('Table of Contents');
  doc.moveDown(0.5);
  if (pages.length) {
    doc.fontSize(12).font('Helvetica-Bold').text('Wiki Pages');
    pages.forEach((p) => {
      doc.fontSize(10).font('Helvetica').text(`  • ${p.title}`);
    });
    doc.moveDown(0.5);
  }
  if (rules.length) {
    doc.fontSize(12).font('Helvetica-Bold').text('Detection Rules');
    rules.forEach((r) => {
      doc.fontSize(10).font('Helvetica').text(`  • ${r.page.title}`);
    });
  }

  // Pages
  if (pages.length) {
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fill('#1e1b4b').text('Wiki Pages');
    doc.fill('#000000').moveDown();

    for (const p of pages) {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text(p.title);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#d1d5db');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').text(mdToPlain(p.contentMd), { lineGap: 2 });

      // SPL Command section
      if (p.splCommand) {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').fill('#b45309').text(`SPL Command: ${p.splCommand.command}`);
        doc.fill('#000000').fontSize(10).font('Helvetica');
        doc.text(`Group: ${p.splCommand.group}`);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').text('Syntax:');
        doc.font('Courier').fontSize(9).text(p.splCommand.syntax, { lineGap: 1 });
        if (p.splCommand.description) {
          doc.font('Helvetica-Bold').fontSize(10).text('Description:');
          doc.font('Helvetica').text(mdToPlain(p.splCommand.description), { lineGap: 1 });
        }
        if (p.splCommand.examples) {
          doc.font('Helvetica-Bold').text('Examples:');
          doc.font('Courier').fontSize(9).text(p.splCommand.examples, { lineGap: 1 });
        }
        if (p.splCommand.pitfalls) {
          doc.font('Helvetica-Bold').fontSize(10).text('Pitfalls:');
          doc.font('Helvetica').text(mdToPlain(p.splCommand.pitfalls), { lineGap: 1 });
        }
        doc.fill('#000000');
      }

      doc.moveDown();
    }
  }

  // Rules
  if (rules.length) {
    doc.addPage();
    doc.fontSize(20).font('Helvetica-Bold').fill('#1e1b4b').text('Detection Rules');
    doc.fill('#000000').moveDown();

    for (const r of rules) {
      if (doc.y > 580) doc.addPage();
      doc.fontSize(13).font('Helvetica-Bold').text(r.page.title);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Severity: ${r.severity || 'N/A'}  |  Status: ${r.status || 'N/A'}`);
      if (r.mitreTactics) doc.text(`Tactics: ${r.mitreTactics}`);
      if (r.mitreTechniques) doc.text(`Techniques: ${r.mitreTechniques}`);
      if (r.dataSource) doc.text(`Data Source: ${r.dataSource}`);
      if (r.splQuery) {
        doc.moveDown(0.3);
        doc.fontSize(9).font('Courier-Bold').text('SPL Query:');
        doc.font('Courier').text(r.splQuery, { lineGap: 1 });
        doc.font('Helvetica');
      }
      if (r.nativeQuery) {
        doc.moveDown(0.3);
        doc.fontSize(9).font('Courier-Bold').text(`${nativeLabel(r)}:`);
        doc.font('Courier').text(r.nativeQuery, { lineGap: 1 });
        doc.font('Helvetica');
      }
      if (r.falsePositives) {
        doc.moveDown(0.2);
        doc.fontSize(10).font('Helvetica-Bold').text('False Positives:');
        doc.font('Helvetica').text(r.falsePositives, { lineGap: 1 });
      }
      if (r.references) {
        doc.moveDown(0.2);
        doc.fontSize(10).font('Helvetica-Bold').text('References:');
        doc.font('Helvetica').text(mdToPlain(r.references), { lineGap: 1 });
      }
      if (r.testNotes) {
        doc.moveDown(0.2);
        doc.fontSize(10).font('Helvetica-Bold').text('Test Notes:');
        doc.font('Helvetica').text(mdToPlain(r.testNotes), { lineGap: 1 });
      }
      doc.moveDown();
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

export async function exportSinglePagePDF(page: DocPage): Promise<string> {
  const filename = `${sanitizeFilename(page.title)}_${Date.now()}.pdf`;
  const filePath = join(DOCS_DIR, filename);
  await ensureDir(filePath);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.rect(0, 0, doc.page.width, 80).fill('#1e1b4b');
  doc.fill('#ffffff').fontSize(20).font('Helvetica-Bold').text(page.title, 50, 22, { width: 495 });
  doc.fontSize(9).font('Helvetica').fillColor('rgba(255,255,255,0.8)').text(
    `Type: ${page.type}  |  ${page.createdAt ? new Date(page.createdAt).toLocaleDateString() : ''}`,
    50, 52, { width: 495 }
  );
  doc.y = 100;

  // Tags
  if (page.tags?.length) {
    doc.fill('#374151').fontSize(9).font('Helvetica').text(`Tags: ${page.tags.map((t) => t.tag.name).join(', ')}`);
    doc.moveDown(0.5);
  }

  doc.fillColor('#000000');

  // Main content
  doc.fontSize(11).font('Helvetica').text(mdToPlain(page.contentMd), { lineGap: 3 });

  // Detection Rule section
  if (page.rule) {
    const r = page.rule;
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#6366f1');
    doc.moveDown(0.3);
    doc.fontSize(13).font('Helvetica-Bold').fill('#312e81').text('Detection Rule');
    doc.fill('#000000').fontSize(10).font('Helvetica');
    doc.text(`Severity: ${r.severity || 'N/A'}  |  Status: ${r.status || 'N/A'}`);
    if (r.mitreTactics) doc.text(`Tactics: ${r.mitreTactics}`);
    if (r.mitreTechniques) doc.text(`Techniques: ${r.mitreTechniques}`);
    if (r.dataSource) doc.text(`Data Source: ${r.dataSource}`);
    if (r.splQuery) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('SPL Query:');
      doc.font('Courier').fontSize(9).text(r.splQuery, { lineGap: 1 });
      doc.font('Helvetica').fontSize(10);
    }
    if (r.falsePositives) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').text('False Positives:');
      doc.font('Helvetica').text(r.falsePositives, { lineGap: 1 });
    }
    if (r.references) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').text('References:');
      doc.font('Helvetica').text(mdToPlain(r.references), { lineGap: 1 });
    }
    if (r.testNotes) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').text('Test Notes:');
      doc.font('Helvetica').text(mdToPlain(r.testNotes), { lineGap: 1 });
    }
  }

  // SPL Command section
  if (page.splCommand) {
    const spl = page.splCommand;
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#f59e0b');
    doc.moveDown(0.3);
    doc.fontSize(13).font('Helvetica-Bold').fill('#92400e').text(`SPL Command: ${spl.command}`);
    doc.fill('#000000').fontSize(10).font('Helvetica');
    doc.text(`Group: ${spl.group}`);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Syntax:');
    doc.font('Courier').fontSize(9).text(spl.syntax, { lineGap: 1 });
    if (spl.description) {
      doc.font('Helvetica-Bold').fontSize(10).text('Description:');
      doc.font('Helvetica').text(mdToPlain(spl.description), { lineGap: 1 });
    }
    if (spl.examples) {
      doc.font('Helvetica-Bold').text('Examples:');
      doc.font('Courier').fontSize(9).text(spl.examples, { lineGap: 1 });
    }
    if (spl.pitfalls) {
      doc.font('Helvetica-Bold').fontSize(10).text('Pitfalls:');
      doc.font('Helvetica').text(mdToPlain(spl.pitfalls), { lineGap: 1 });
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

export async function exportDetectionMatrix(rules: DocRule[], title = 'Detection Matrix'): Promise<string> {
  const filename = `${sanitizeFilename(title)}_${Date.now()}.pdf`;
  const filePath = join(DOCS_DIR, filename);
  await ensureDir(filePath);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);

  const severities = ['critical', 'high', 'medium', 'low'];
  const severityColors: Record<string, string> = {
    critical: '#dc2626', high: '#ea580c', medium: '#f59e0b', low: '#10b981',
  };

  // Group by technique (all techniques, not just first)
  const byTechnique: Record<string, DocRule[]> = {};
  for (const r of rules) {
    const techs = (r.mitreTechniques || 'Uncategorized')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tech of techs) {
      if (!byTechnique[tech]) byTechnique[tech] = [];
      byTechnique[tech].push(r);
    }
  }

  doc.fontSize(18).font('Helvetica-Bold').text(title);
  doc.fontSize(10).font('Helvetica').text(
    `Generated on ${new Date().toLocaleDateString()} · ${rules.length} rules · ${Object.keys(byTechnique).length} techniques`
  );
  doc.moveDown();

  const colW = 130;
  const rowH = 22;
  const startX = 30;
  let y = doc.y;

  // Header row
  doc.rect(startX, y, colW * 2, rowH).fill('#1e1b4b');
  doc.fill('#ffffff').fontSize(9).text('MITRE Technique', startX + 5, y + 6, { width: colW * 2 - 10 });
  severities.forEach((sev, i) => {
    const x = startX + colW * 2 + colW * i;
    doc.rect(x, y, colW, rowH).fill('#334155');
    doc.fill('#ffffff').text(sev.charAt(0).toUpperCase() + sev.slice(1), x + 5, y + 6, { width: colW - 10 });
  });
  y += rowH;

  // Data rows
  const techniques = Object.keys(byTechnique).sort();
  for (let idx = 0; idx < techniques.length; idx++) {
    if (y > 530) { doc.addPage(); y = 30; }
    const tech = techniques[idx];
    const bg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
    doc.rect(startX, y, colW * 2, rowH).fill(bg);
    doc.fill('#1f2937').fontSize(8).text(tech.slice(0, 35), startX + 5, y + 7, { width: colW * 2 - 10 });

    severities.forEach((sev, i) => {
      const x = startX + colW * 2 + colW * i;
      const count = byTechnique[tech].filter((r) => (r.severity || '').toLowerCase() === sev).length;
      doc.rect(x, y, colW, rowH).fill(bg);
      if (count > 0) {
        doc.rect(x + 2, y + 2, colW - 4, rowH - 4).fill(severityColors[sev]);
        doc.fill('#ffffff').text(String(count), x + 5, y + 7, { width: colW - 10, align: 'center' });
      } else {
        doc.fill('#9ca3af').text('0', x + 5, y + 7, { width: colW - 10, align: 'center' });
      }
    });
    y += rowH;
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

export async function getFileSize(filePath: string): Promise<number> {
  const stat = await fsp.stat(filePath);
  return stat.size;
}
