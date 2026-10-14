import { TACTICS, TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from '../../lib/attack';
import {
  LANGUAGE_LABELS,
  PAGE_TYPE_LABELS,
  SEVERITIES,
  SOURCE_LABELS,
  STATUSES,
  cap,
  coveredTechniques,
  day,
  description,
  referenceItems,
  tacticNames,
  techniqueLines,
} from '../report-content';
import { COLORS, ReportPdf, SEVERITY_COLORS, STATUS_COLORS, isRtl } from './ReportPdf';

// The PDF documents DetectKB exports: the detection report (selected rules
// and knowledge pages), a single page, and the technique × severity matrix.

export interface PdfRule {
  id: number;
  page: { title: string; contentMd?: string | null; tags?: { tag: { name: string } }[] };
  severity?: string | null;
  status?: string | null;
  sourceFormat?: string | null;
  splQuery?: string | null;
  nativeQuery?: string | null;
  nativeLanguage?: string | null;
  mitreTactics?: string | null;
  mitreTechniques?: string | null;
  dataSource?: string | null;
  falsePositives?: string | null;
  references?: string | null;
  testNotes?: string | null;
}

export interface PdfPage {
  id: number;
  title: string;
  type: string;
  contentMd: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  tags?: { tag: { name: string } }[];
  splCommand?: { command: string; group: string; syntax: string; description: string; examples: string; pitfalls?: string | null } | null;
  rule?: Omit<PdfRule, 'id' | 'page'> | null;
}

function ruleBadges(r: Pick<PdfRule, 'severity' | 'status' | 'sourceFormat'>) {
  const out: { text: string; color: string; outline?: boolean }[] = [];
  if (r.severity) out.push({ text: r.severity.toUpperCase(), color: SEVERITY_COLORS[r.severity] ?? COLORS.muted });
  if (r.status) out.push({ text: cap(r.status), color: STATUS_COLORS[r.status] ?? COLORS.muted, outline: true });
  out.push({ text: r.sourceFormat ? SOURCE_LABELS[r.sourceFormat] ?? r.sourceFormat : 'Written in DetectKB', color: COLORS.muted, outline: true });
  return out;
}

/** The body of a rule: metadata, description, queries, false positives, references, test notes. */
function ruleBody(pdf: ReportPdf, r: Omit<PdfRule, 'id' | 'page'>, page: PdfRule['page'] | null) {
  pdf.badges(ruleBadges(r));
  const tags = page?.tags?.map((t) => t.tag.name).join(', ') ?? '';
  pdf.keyValues([
    ['Tactics', tacticNames(r).join('\n')],
    ['Techniques', techniqueLines(r.mitreTechniques).join('\n')],
    ['Data source', r.dataSource ?? ''],
    ['Tags', tags],
  ]);
  const desc = page ? description(page.contentMd) : '';
  if (desc) {
    pdf.space(4);
    pdf.label('Description');
    pdf.markdown(desc);
  }
  if (r.splQuery?.trim()) {
    pdf.space(4);
    pdf.code(r.splQuery, { label: 'SPL query' });
  }
  if (r.nativeQuery?.trim()) {
    pdf.space(2);
    pdf.code(r.nativeQuery, { label: `${LANGUAGE_LABELS[r.nativeLanguage ?? ''] ?? r.nativeLanguage ?? 'Native'} query` });
  }
  if (r.falsePositives?.trim()) {
    pdf.label('False positives');
    pdf.markdown(r.falsePositives);
  }
  if (r.testNotes?.trim()) {
    pdf.label('Test notes');
    pdf.markdown(r.testNotes);
  }
  if (r.references?.trim()) {
    pdf.label('References');
    pdf.bullets(referenceItems(r.references), { size: 8.5 });
  }
}

function splCommandBody(pdf: ReportPdf, spl: NonNullable<PdfPage['splCommand']>) {
  pdf.badges([{ text: `SPL · ${spl.group}`, color: '#92400e' }]);
  pdf.code(spl.syntax, { label: 'Syntax' });
  if (spl.description?.trim()) {
    pdf.label('Description');
    pdf.markdown(spl.description);
  }
  if (spl.examples?.trim()) pdf.code(spl.examples, { label: 'Examples' });
  if (spl.pitfalls?.trim()) {
    pdf.label('Pitfalls');
    pdf.markdown(spl.pitfalls);
  }
}

function cover(pdf: ReportPdf, title: string, stats: [string, string][], subtitle: string) {
  const { doc } = pdf;
  const w = doc.page.width;
  const h = doc.page.height;
  doc.rect(0, 0, w, h).fillColor(COLORS.brandDark).fill();
  doc.rect(0, h * 0.62, w, h * 0.38).fillColor(COLORS.brand).fill();
  doc.rect(pdf.left, 150, 46, 4).fillColor('#a5b4fc').fill();
  doc.y = 170;
  pdf.text(title, { size: 30, font: 'bold', color: '#ffffff', lineGap: 4, after: 8 });
  pdf.text(subtitle, { size: 12, color: '#c7d2fe', after: 4 });
  pdf.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), { size: 11, color: '#c7d2fe' });
  // Stat tiles
  const tileW = (pdf.width - 12 * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = pdf.left + i * (tileW + 12);
    const y = h * 0.62 + 40;
    doc.roundedRect(x, y, tileW, 74, 6).fillColor('#ffffff').fillOpacity(0.08).fill();
    doc.fillOpacity(1);
    doc.font('bold').fontSize(24).fillColor('#ffffff').text(value, x + 14, y + 12, { width: tileW - 28, lineBreak: false });
    doc.font('regular').fontSize(9).fillColor('#c7d2fe').text(label, x + 14, y + 48, { width: tileW - 28, lineBreak: false });
  });
  // Below the bottom margin: without lifting it PDFKit would start a new page
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.font('regular').fontSize(8.5).fillColor('#a5b4fc').text('DetectKB · detection engineering knowledge base', pdf.left, h - 60, { width: pdf.width, lineBreak: false });
  doc.page.margins.bottom = bottomMargin;
}

/** Horizontal bar rows: label, bar, count. */
function bars(pdf: ReportPdf, rows: { label: string; count: number; color: string }[], total: number) {
  const { doc } = pdf;
  const labelW = 110;
  const countW = 40;
  const barW = pdf.width - labelW - countW - 10;
  for (const r of rows) {
    pdf.ensure(18);
    const y = pdf.y;
    doc.font('regular').fontSize(9).fillColor(COLORS.text).text(r.label, pdf.left, y, { width: labelW, lineBreak: false });
    doc.roundedRect(pdf.left + labelW, y + 2, barW, 8, 4).fillColor('#f1f5f9').fill();
    if (r.count) doc.roundedRect(pdf.left + labelW, y + 2, Math.max(8, (barW * r.count) / Math.max(total, 1)), 8, 4).fillColor(r.color).fill();
    doc.font('bold').fontSize(9).fillColor(COLORS.ink).text(String(r.count), pdf.left + labelW + barW + 10, y, { width: countW, align: 'right', lineBreak: false });
    pdf.y = y + 17;
  }
  pdf.space(6);
}

/** The detection report: cover, summary, contents with page numbers, rules, knowledge pages. */
export async function renderDetectionReport(filePath: string, title: string, pages: PdfPage[], rules: PdfRule[]) {
  const pdf = new ReportPdf({ title });
  const { doc } = pdf;
  const techniques = coveredTechniques(rules);
  const stats: [string, string][] = [];
  if (rules.length) stats.push(['Detection rules', String(rules.length)], ['ATT&CK techniques', String(techniques.size)]);
  if (rules.length) stats.push(['In production', String(rules.filter((r) => r.status === 'production').length)]);
  if (pages.length) stats.push(['Knowledge pages', String(pages.length)]);
  cover(pdf, title, stats, rules.length ? 'Detection rules and coverage' : 'Knowledge base pages');

  // Summary
  if (rules.length) {
    pdf.addPage();
    doc.outline.addItem('Summary');
    pdf.h1('Summary');
    pdf.label('By severity', 60);
    bars(
      pdf,
      SEVERITIES.map((s) => ({ label: cap(s), count: rules.filter((r) => r.severity === s).length, color: SEVERITY_COLORS[s] })).filter((r) => r.count),
      rules.length
    );
    pdf.label('By status', 60);
    bars(
      pdf,
      STATUSES.map((s) => ({ label: cap(s), count: rules.filter((r) => r.status === s).length, color: STATUS_COLORS[s] })).filter((r) => r.count),
      rules.length
    );
    const byTactic = TACTICS.map((t) => ({ label: t.name, count: rules.filter((r) => tacticNames(r).some((n) => n.endsWith(`(${t.id})`))).length, color: COLORS.brand })).filter(
      (r) => r.count
    );
    if (byTactic.length) {
      pdf.label('By ATT&CK tactic', 60);
      bars(pdf, byTactic, rules.length);
    }
    const sources = Array.from(new Set(rules.map((r) => r.sourceFormat ?? 'manual')));
    if (sources.length > 1) {
      pdf.label('By source', 60);
      bars(
        pdf,
        sources.map((s) => ({ label: s === 'manual' ? 'Written in DetectKB' : SOURCE_LABELS[s] ?? s, count: rules.filter((r) => (r.sourceFormat ?? 'manual') === s).length, color: '#0f766e' })),
        rules.length
      );
    }
  }

  // Contents: pages reserved now, filled in once the page numbers are known
  const tocRows = (rules.length ? rules.length + 2 : 0) + (pages.length ? pages.length + 2 : 0);
  const rowsPerPage = Math.floor((pdf.bottom - pdf.top - 70) / 17);
  const tocStart = doc.bufferedPageRange().count;
  for (let i = 0; i < Math.max(1, Math.ceil(tocRows / rowsPerPage)); i++) pdf.addPage();

  // The number the footer prints on the current page (the cover is not counted)
  const pageNumber = () => doc.bufferedPageRange().count - 1;
  const ruleEntries: { title: string; page: number; anchor: string; severity?: string | null }[] = [];
  const pageEntries: { title: string; page: number; anchor: string }[] = [];

  if (rules.length) {
    pdf.addPage();
    doc.outline.addItem('Detection rules');
    pdf.h1('Detection rules', { anchor: 'rules' });
    rules.forEach((r, i) => {
      // A rule starts on a new page unless most of its header fits
      pdf.ensure(170);
      const anchor = `rule-${r.id}`;
      doc.addNamedDestination(anchor);
      ruleEntries.push({ title: r.page.title, page: pageNumber(), anchor, severity: r.severity });
      doc.outline.addItem(r.page.title);
      pdf.text(`${i + 1}.  ${r.page.title}`, { size: 14, font: 'bold', color: COLORS.ink, after: 6 });
      ruleBody(pdf, r, r.page);
      if (i < rules.length - 1) pdf.divider(14);
    });
  }

  if (pages.length) {
    pdf.addPage();
    doc.outline.addItem('Knowledge pages');
    pdf.h1('Knowledge pages', { anchor: 'pages' });
    pages.forEach((p, i) => {
      pdf.ensure(120);
      const anchor = `page-${p.id}`;
      doc.addNamedDestination(anchor);
      pageEntries.push({ title: p.title, page: pageNumber(), anchor });
      doc.outline.addItem(p.title);
      pdf.text(p.title, { size: 14, font: 'bold', color: COLORS.ink, after: 4 });
      const meta = [PAGE_TYPE_LABELS[p.type] ?? p.type, ...(p.tags?.map((t) => `#${t.tag.name}`) ?? [])].join('   ');
      pdf.text(meta, { size: 8.5, color: COLORS.muted, after: 8, align: isRtl(p.title) ? 'right' : 'left' });
      pdf.markdown(p.contentMd);
      if (p.splCommand) splCommandBody(pdf, p.splCommand);
      if (i < pages.length - 1) pdf.divider(14);
    });
  }

  // Fill the contents
  let tocPage = tocStart;
  doc.switchToPage(tocPage);
  pdf.y = pdf.top;
  pdf.h1('Contents');
  const row = (label: string, page: number, anchor: string, o: { bold?: boolean; dot?: string } = {}) => {
    if (pdf.y + 20 > pdf.bottom) {
      doc.switchToPage(++tocPage);
      pdf.y = pdf.top;
    }
    const y = pdf.y;
    const num = String(page);
    doc.font(o.bold ? 'bold' : 'regular').fontSize(o.bold ? 10.5 : 9.5);
    const numW = doc.widthOfString(num);
    let x = pdf.left;
    if (o.dot) {
      doc.circle(x + 3, y + 6.5, 2.8).fillColor(o.dot).fill();
      x += 12;
    }
    const labelW = pdf.right - x - numW - 30;
    doc.fillColor(o.bold ? COLORS.brandDark : COLORS.text).text(label, x, y, { width: labelW, lineBreak: false, ellipsis: true });
    const textW = Math.min(doc.widthOfString(label), labelW);
    doc.save();
    doc.moveTo(x + textW + 6, y + 10).lineTo(pdf.right - numW - 6, y + 10).dash(1, { space: 2.5 }).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    doc.restore();
    doc.fillColor(COLORS.muted).text(num, pdf.right - numW, y, { lineBreak: false });
    // The whole row jumps to the entry
    doc.goTo(pdf.left, y - 2, pdf.width, 16, anchor);
    pdf.y = y + (o.bold ? 21 : 17);
  };
  if (ruleEntries.length) {
    row('Detection rules', ruleEntries[0].page, 'rules', { bold: true });
    for (const e of ruleEntries) row(e.title, e.page, e.anchor, { dot: SEVERITY_COLORS[e.severity ?? ''] ?? COLORS.faint });
    pdf.space(8);
  }
  if (pageEntries.length) {
    row('Knowledge pages', pageEntries[0].page, 'pages', { bold: true });
    for (const e of pageEntries) row(e.title, e.page, e.anchor);
  }

  pdf.finish({ title, skip: 1, subtitle: 'DetectKB detection report' });
  return pdf.save(filePath);
}

/** One knowledge page (and its rule or SPL command). */
export async function renderPagePdf(filePath: string, page: PdfPage) {
  const pdf = new ReportPdf({ title: page.title });
  const { doc } = pdf;
  // Title band
  doc.rect(0, 0, doc.page.width, 118).fillColor(COLORS.brandDark).fill();
  doc.y = 52;
  pdf.text(page.title, { size: 20, font: 'bold', color: '#ffffff', lineGap: 2 });
  const meta = [
    PAGE_TYPE_LABELS[page.type] ?? page.type,
    page.updatedAt ? `updated ${day(new Date(page.updatedAt))}` : '',
    ...(page.tags?.map((t) => `#${t.tag.name}`) ?? []),
  ].filter(Boolean);
  pdf.text(meta.join('   '), { size: 8.5, color: '#c7d2fe', align: isRtl(page.title) ? 'right' : 'left' });
  pdf.y = Math.max(pdf.y, 118) + 24;

  if (page.rule) {
    ruleBody(pdf, page.rule, { title: page.title, contentMd: page.contentMd, tags: page.tags });
    // The rest of the page after the description
    const rest = page.contentMd.split(/\n(?=#{1,6}\s)/).slice(1).join('\n').trim();
    if (rest) {
      pdf.divider(12);
      pdf.markdown(rest);
    }
  } else {
    pdf.markdown(page.contentMd);
  }
  if (page.splCommand) {
    pdf.divider(12);
    splCommandBody(pdf, page.splCommand);
  }
  pdf.finish({ title: page.title, subtitle: PAGE_TYPE_LABELS[page.type] ?? page.type, noHeaderOnFirst: true });
  return pdf.save(filePath);
}

/** Techniques (grouped by tactic) × severity, counting rules. */
export async function renderMatrixPdf(filePath: string, title: string, rules: Pick<PdfRule, 'severity' | 'mitreTechniques'>[]) {
  const pdf = new ReportPdf({ title, landscape: true });
  const { doc } = pdf;
  const sev = ['critical', 'high', 'medium', 'low', 'info'];
  const byTechnique = new Map<string, Record<string, number>>();
  let unmapped = 0;
  for (const r of rules) {
    const ids = Array.from(new Set(parseTechniqueIds(r.mitreTechniques).map((id) => resolveTechniqueId(id) ?? id)));
    if (!ids.length) unmapped++;
    for (const id of ids) {
      const row = byTechnique.get(id) ?? {};
      const s = r.severity ?? 'info';
      row[s] = (row[s] ?? 0) + 1;
      byTechnique.set(id, row);
    }
  }
  pdf.h1(title);
  pdf.text(`${rules.length} rules · ${byTechnique.size} techniques${unmapped ? ` · ${unmapped} rule${unmapped === 1 ? '' : 's'} without a technique` : ''}`, { size: 9, color: COLORS.muted, after: 10 });

  const nameW = pdf.width - sev.length * 64 - 50;
  const header = () => {
    const y = pdf.y;
    doc.rect(pdf.left, y, pdf.width, 20).fillColor(COLORS.brandDark).fill();
    doc.font('bold').fontSize(8.5).fillColor('#ffffff').text('Technique', pdf.left + 8, y + 6, { width: nameW, lineBreak: false });
    sev.forEach((s, i) => doc.text(cap(s), pdf.left + nameW + i * 64, y + 6, { width: 64, align: 'center', lineBreak: false }));
    doc.text('Total', pdf.left + nameW + sev.length * 64, y + 6, { width: 50, align: 'center', lineBreak: false });
    pdf.y = y + 20;
  };
  const tacticOf = (id: string) => TECHNIQUE_BY_ID.get(id)?.tactics[0] ?? 'other';
  for (const tactic of [...TACTICS.map((t) => t.shortname), 'other']) {
    const ids = Array.from(byTechnique.keys())
      .filter((id) => tacticOf(id) === tactic)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (!ids.length) continue;
    pdf.ensure(64);
    if (pdf.y === pdf.top || pdf.y < pdf.top + 1) header();
    const name = TACTICS.find((t) => t.shortname === tactic)?.name ?? 'Not in ATT&CK';
    pdf.text(name, { size: 10, font: 'bold', color: COLORS.brand, after: 2 });
    header();
    ids.forEach((id, n) => {
      if (pdf.y + 18 > pdf.bottom) {
        pdf.addPage();
        header();
      }
      const y = pdf.y;
      const counts = byTechnique.get(id)!;
      if (n % 2) doc.rect(pdf.left, y, pdf.width, 18).fillColor('#f8fafc').fill();
      const t = TECHNIQUE_BY_ID.get(id);
      doc.font('bold').fontSize(8).fillColor(COLORS.ink).text(id, pdf.left + 8, y + 5, { width: 62, lineBreak: false });
      doc.font('regular').fillColor(COLORS.text).text(t?.name ?? '—', pdf.left + 70, y + 5, { width: nameW - 74, lineBreak: false, ellipsis: true });
      let total = 0;
      sev.forEach((s, i) => {
        const c = counts[s] ?? 0;
        total += c;
        const x = pdf.left + nameW + i * 64;
        if (c) {
          doc.roundedRect(x + 16, y + 3, 32, 12, 6).fillColor(SEVERITY_COLORS[s]).fill();
          doc.font('bold').fontSize(7.5).fillColor('#ffffff').text(String(c), x + 16, y + 5.5, { width: 32, align: 'center', lineBreak: false });
        } else doc.font('regular').fontSize(8).fillColor('#cbd5e1').text('·', x, y + 5, { width: 64, align: 'center', lineBreak: false });
      });
      doc.font('bold').fontSize(8).fillColor(COLORS.ink).text(String(total), pdf.left + nameW + sev.length * 64, y + 5, { width: 50, align: 'center', lineBreak: false });
      pdf.y = y + 18;
    });
    pdf.space(10);
  }
  pdf.finish({ title, subtitle: 'DetectKB detection matrix' });
  return pdf.save(filePath);
}
