import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import bidiFactory from 'bidi-js';

// Layout primitives for DetectKB's PDF exports: fonts that cover Latin and
// Persian, paragraphs laid out with the Unicode bidi algorithm (PDFKit has
// none, so Persian lines came out in the wrong order), headings, badges,
// key/value rows, shaded code blocks that continue across pages, simple
// Markdown, and a running header / footer with page numbers.

const bidi = bidiFactory();

export const COLORS = {
  ink: '#111827',
  text: '#1f2937',
  muted: '#6b7280',
  faint: '#9ca3af',
  rule: '#e5e7eb',
  brand: '#312e81',
  brandDark: '#1e1b4b',
  brandSoft: '#eef2ff',
  codeBg: '#f6f7f9',
  codeBorder: '#e3e6ea',
  link: '#1d4ed8',
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#b91c1c',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#64748b',
};

export const STATUS_COLORS: Record<string, string> = {
  production: '#15803d',
  testing: '#b45309',
  draft: '#475569',
  deprecated: '#b91c1c',
};

type FontName = 'regular' | 'bold' | 'mono' | 'monoBold';

/** Vazirmatn (OFL, npm package) covers Latin and Persian; Courier is for queries. */
function fontFiles(): { regular: string; bold: string } | null {
  try {
    const dir = path.join(path.dirname(require.resolve('vazirmatn/package.json')), 'fonts', 'ttf');
    const regular = path.join(dir, 'Vazirmatn-Regular.ttf');
    const bold = path.join(dir, 'Vazirmatn-Bold.ttf');
    return fs.existsSync(regular) && fs.existsSync(bold) ? { regular, bold } : null;
  } catch {
    return null;
  }
}
const FONTS = fontFiles();

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
export const hasRtl = (s: string) => RTL_CHARS.test(s);
/** The paragraph's base direction is right to left (its first strong character is Persian / Arabic). */
export const isRtl = (s: string) => hasRtl(s) && (bidi.getEmbeddingLevels(s).paragraphs[0]?.level ?? 0) % 2 === 1;

export interface TextOptions {
  size?: number;
  font?: FontName;
  color?: string;
  /** Left edge and width of the text box (default: the page's content box) */
  x?: number;
  width?: number;
  align?: 'left' | 'right' | 'center';
  lineGap?: number;
  link?: string;
  /** Space after the paragraph */
  after?: number;
}

export class ReportPdf {
  readonly doc: PDFKit.PDFDocument;
  readonly left = 50;
  readonly right: number;
  readonly width: number;
  readonly top = 64;
  readonly bottom: number;

  constructor(opts: { title: string; landscape?: boolean }) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout: opts.landscape ? 'landscape' : 'portrait',
      margins: { top: 64, bottom: 60, left: 50, right: 50 },
      bufferPages: true,
      autoFirstPage: true,
      info: { Title: opts.title, Creator: 'DetectKB', Producer: 'DetectKB' },
    });
    if (FONTS) {
      this.doc.registerFont('regular', FONTS.regular);
      this.doc.registerFont('bold', FONTS.bold);
    } else {
      this.doc.registerFont('regular', 'Helvetica');
      this.doc.registerFont('bold', 'Helvetica-Bold');
    }
    this.doc.registerFont('mono', 'Courier');
    this.doc.registerFont('monoBold', 'Courier-Bold');
    this.right = this.doc.page.width - 50;
    this.width = this.right - this.left;
    this.bottom = this.doc.page.height - 60;
    this.doc.font('regular').fontSize(10).fillColor(COLORS.text);
  }

  get y() {
    return this.doc.y;
  }
  set y(v: number) {
    this.doc.y = v;
  }

  addPage() {
    this.doc.addPage();
    this.doc.x = this.left;
    this.doc.y = this.top;
  }

  /** Starts a new page unless `height` still fits. */
  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.addPage();
  }

  space(h: number) {
    this.doc.y += h;
  }

  private use(font: FontName, size: number, color: string) {
    // Courier has no Persian: such "code" falls back to the text font
    this.doc.font(font).fontSize(size).fillColor(color);
  }

  /** Height a paragraph will take (Latin text; RTL text is close enough for planning). */
  heightOf(text: string, o: TextOptions = {}) {
    this.use(o.font ?? 'regular', o.size ?? 10, o.color ?? COLORS.text);
    return this.doc.heightOfString(text || ' ', { width: o.width ?? this.width, lineGap: o.lineGap ?? 2 });
  }

  /** A paragraph; lines with Persian / Arabic text are laid out right to left. */
  text(text: string, o: TextOptions = {}) {
    const font = o.font && (o.font === 'mono' || o.font === 'monoBold') && hasRtl(text) ? 'regular' : o.font ?? 'regular';
    const size = o.size ?? 10;
    const color = o.color ?? COLORS.text;
    const x = o.x ?? this.left;
    const width = o.width ?? this.right - x;
    const lineGap = o.lineGap ?? 2;
    this.use(font, size, color);
    for (const para of text.replace(/\r/g, '').split('\n')) {
      if (hasRtl(para) && FONTS) this.bidiParagraph(para, { font, size, color, x, width, lineGap, align: o.align });
      else {
        this.doc.text(para || ' ', x, this.doc.y, { width, lineGap, align: o.align ?? 'left', link: o.link, underline: false });
      }
    }
    this.doc.x = this.left;
    if (o.after) this.doc.y += o.after;
  }

  /**
   * One paragraph through the bidi algorithm: words are wrapped in logical
   * order, then each line's runs are placed in visual order.
   */
  private bidiParagraph(para: string, o: { font: FontName; size: number; color: string; x: number; width: number; lineGap: number; align?: string }) {
    const { doc } = this;
    const levels = bidi.getEmbeddingLevels(para);
    const rtlParagraph = (levels.paragraphs[0]?.level ?? 0) % 2 === 1;
    const lineHeight = doc.currentLineHeight(true) + o.lineGap;
    // Wrap on spaces, by measured width
    const lines: [number, number][] = [];
    const words = Array.from(para.matchAll(/\S+\s*/g));
    let start = 0;
    let end = 0;
    for (const w of words) {
      const wEnd = (w.index ?? 0) + w[0].length;
      if (end > start && doc.widthOfString(para.slice(start, wEnd).trimEnd()) > o.width) {
        lines.push([start, end]);
        start = w.index ?? 0;
      }
      end = wEnd;
    }
    lines.push([start, Math.max(end, start)]);

    for (const [s, e] of lines) {
      if (doc.y + lineHeight > this.bottom) this.addPage();
      const lineText = para.slice(s, e).replace(/\s+$/, '');
      const lineEnd = s + lineText.length;
      if (!lineText) {
        doc.y += lineHeight;
        continue;
      }
      // Visual order of the characters, grouped into runs of one direction
      // (returns the whole paragraph's indices, with this line's range reordered)
      const order = bidi.getReorderedIndices(para, levels, s, lineEnd - 1).filter((i) => i >= s && i < lineEnd);
      const runs: { from: number; to: number }[] = [];
      for (const i of order) {
        const last = runs[runs.length - 1];
        const rtl = levels.levels[i] % 2 === 1;
        if (last && (levels.levels[last.from] % 2 === 1) === rtl && (rtl ? i === last.from - 1 : i === last.to + 1)) {
          if (rtl) last.from = i;
          else last.to = i;
        } else runs.push({ from: i, to: i });
      }
      // PDFKit draws the words of a string left to right and fontkit only
      // mirrors the glyphs inside each word, so a right-to-left run is placed
      // word by word, last word first
      const pieces = runs.flatMap((r) => {
        const t = para.slice(r.from, r.to + 1);
        const parts = levels.levels[r.from] % 2 === 1 ? t.split(/(\s+)/).filter(Boolean).reverse() : [t];
        return parts.map((part) => ({ t: part, w: doc.widthOfString(part), blank: !part.trim() }));
      });
      const total = pieces.reduce((n, p) => n + p.w, 0);
      const align = o.align ?? (rtlParagraph ? 'right' : 'left');
      let cx = align === 'right' ? o.x + o.width - total : align === 'center' ? o.x + (o.width - total) / 2 : o.x;
      const y = doc.y;
      for (const p of pieces) {
        if (!p.blank) doc.text(p.t, cx, y, { lineBreak: false });
        cx += p.w;
      }
      doc.y = y + lineHeight;
    }
  }

  h1(text: string, o: { color?: string; anchor?: string } = {}) {
    this.ensure(60);
    if (o.anchor) this.doc.addNamedDestination(o.anchor);
    this.text(text, { size: 20, font: 'bold', color: o.color ?? COLORS.brandDark, after: 4 });
    const y = this.doc.y;
    this.doc.moveTo(this.left, y).lineTo(this.left + 40, y).lineWidth(2.5).strokeColor(COLORS.brand).stroke();
    this.doc.lineWidth(1);
    this.doc.y = y + 14;
  }

  h2(text: string, o: { size?: number; color?: string; keepWith?: number } = {}) {
    this.ensure(40 + (o.keepWith ?? 0));
    this.text(text, { size: o.size ?? 13, font: 'bold', color: o.color ?? COLORS.ink, after: 4 });
  }

  /** Small upper-case label above a block. */
  label(text: string, keepWith = 24) {
    this.ensure(16 + keepWith);
    this.text(text.toUpperCase(), { size: 7.5, font: 'bold', color: COLORS.muted, after: 2 });
  }

  divider(space = 10) {
    this.ensure(space * 2);
    const y = this.doc.y + space;
    this.doc.moveTo(this.left, y).lineTo(this.right, y).lineWidth(0.6).strokeColor(COLORS.rule).stroke();
    this.doc.y = y + space;
  }

  /** A filled pill at (x, y); returns its width. */
  badge(text: string, x: number, y: number, color: string, o: { outline?: boolean } = {}) {
    const { doc } = this;
    doc.font('bold').fontSize(7.5);
    const w = doc.widthOfString(text) + 12;
    const h = 14;
    if (o.outline) doc.roundedRect(x, y, w, h, 7).lineWidth(0.8).strokeColor(color).stroke();
    else doc.roundedRect(x, y, w, h, 7).fillColor(color).fill();
    doc.fillColor(o.outline ? color : '#ffffff').text(text, x, y + 3.2, { width: w, align: 'center', lineBreak: false });
    doc.fillColor(COLORS.text);
    return w;
  }

  /** A row of badges on its own line. */
  badges(items: { text: string; color: string; outline?: boolean }[]) {
    if (!items.length) return;
    this.ensure(22);
    const y = this.doc.y;
    let x = this.left;
    for (const b of items) x += this.badge(b.text, x, y, b.color, { outline: b.outline }) + 6;
    this.doc.y = y + 22;
  }

  /** Label / value rows (values may span lines). */
  keyValues(rows: [string, string][], o: { labelWidth?: number } = {}) {
    const lw = o.labelWidth ?? 92;
    for (const [k, v] of rows) {
      if (!v) continue;
      const h = Math.max(this.heightOf(v, { width: this.width - lw, size: 9.5 }), 12);
      this.ensure(Math.min(h, 120) + 6);
      const y = this.doc.y;
      this.use('bold', 7.5, COLORS.muted);
      this.doc.text(k.toUpperCase(), this.left, y + 1.5, { width: lw - 8, lineBreak: false });
      this.doc.y = y;
      this.text(v, { x: this.left + lw, width: this.width - lw, size: 9.5, color: COLORS.text });
      this.doc.y += 4;
    }
  }

  /** Monospaced text in a shaded box, split across pages when long. */
  code(code: string, o: { label?: string } = {}) {
    const text = code.replace(/\t/g, '  ').replace(/\s+$/, '');
    if (!text) return;
    if (o.label) this.label(o.label, 40);
    const pad = 7;
    const width = this.width - pad * 2 - 3;
    const opts = { font: 'mono' as FontName, size: 8, lineGap: 1.5, width };
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      let available = this.bottom - this.doc.y - pad * 2;
      if (available < 40) {
        this.addPage();
        available = this.bottom - this.doc.y - pad * 2;
      }
      const chunk: string[] = [];
      while (i < lines.length) {
        const next = [...chunk, lines[i]].join('\n');
        if (chunk.length && this.heightOf(next, opts) > available) break;
        chunk.push(lines[i++]);
        if (this.heightOf(chunk.join('\n'), opts) > available) break; // one line taller than the page: let it flow
      }
      const body = chunk.join('\n');
      const h = Math.min(this.heightOf(body, opts), available);
      const y = this.doc.y;
      this.doc.roundedRect(this.left, y, this.width, h + pad * 2, 3).fillColor(COLORS.codeBg).fill();
      this.doc.rect(this.left, y, 2.5, h + pad * 2).fillColor(COLORS.brand).fill();
      this.doc.y = y + pad;
      this.text(body, { x: this.left + pad + 3, ...opts, color: '#111827' });
      this.doc.y = y + h + pad * 2 + 8;
      if (i < lines.length) this.addPage();
    }
  }

  /** Bulleted list; items may be links. */
  bullets(items: { text: string; link?: string }[], o: { size?: number; indent?: number } = {}) {
    const indent = o.indent ?? 0;
    const size = o.size ?? 9.5;
    for (const it of items) {
      this.ensure(14);
      const y = this.doc.y;
      const rtl = isRtl(it.text);
      this.use('regular', size, COLORS.muted);
      this.doc.text('•', rtl ? this.right - indent - 6 : this.left + indent, y, { lineBreak: false });
      this.doc.y = y;
      const x = rtl ? this.left : this.left + indent + 11;
      this.text(it.text, { x, width: this.width - indent - 11, size, color: it.link ? COLORS.link : COLORS.text, link: it.link });
      this.doc.y += 1.5;
    }
  }

  /**
   * Markdown blocks: headings, paragraphs, lists, code fences, quotes and
   * tables. Inline marks are dropped; links keep their text.
   */
  markdown(md: string, o: { size?: number } = {}) {
    const size = o.size ?? 9.5;
    const inline = (s: string) =>
      s
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<[^>]+>/g, '');
    const lines = md.replace(/\r/g, '').split('\n');
    let para: string[] = [];
    const flush = () => {
      if (para.length) this.text(inline(para.join(' ')), { size, after: 5 });
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        flush();
        const body: string[] = [];
        while (++i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i]);
        this.code(body.join('\n'));
        continue;
      }
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flush();
        const level = heading[1].length;
        this.space(level <= 2 ? 4 : 2);
        this.h2(inline(heading[2]), { size: level <= 1 ? 13 : level === 2 ? 12 : 10.5, keepWith: 24 });
        continue;
      }
      if (/^\|.*\|$/.test(trimmed)) {
        flush();
        const rows: string[][] = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        i--;
        this.table(rows);
        continue;
      }
      const item = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/);
      if (item) {
        flush();
        const depth = Math.min(Math.floor((line.length - line.trimStart().length) / 2), 3);
        this.bullets([{ text: inline(item[2]) }], { size, indent: depth * 12 });
        continue;
      }
      if (/^>/.test(trimmed)) {
        flush();
        const y = this.doc.y;
        this.text(inline(trimmed.replace(/^>\s?/, '')), { x: this.left + 10, size, color: COLORS.muted });
        this.doc.rect(this.left, y, 2, this.doc.y - y).fillColor(COLORS.rule).fill();
        continue;
      }
      if (!trimmed) {
        flush();
        continue;
      }
      para.push(trimmed);
    }
    flush();
  }

  /** A simple grid; the first row is the header. */
  table(rows: string[][], o: { widths?: number[]; size?: number } = {}) {
    if (!rows.length) return;
    // A Persian table reads from the right: first column on the right
    const rtl = rows[0].some((c) => isRtl(c));
    if (rtl) rows = rows.map((r) => [...r].reverse());
    const cols = Math.max(...rows.map((r) => r.length));
    const size = o.size ?? 8.5;
    const widths = o.widths ?? Array.from({ length: cols }, () => this.width / cols);
    const pad = 4;
    const rowHeight = (r: string[]) => Math.max(...widths.map((w, c) => this.heightOf(r[c] ?? '', { width: w - pad * 2, size }))) + pad * 2;
    const drawRow = (r: string[], header: boolean) => {
      const h = rowHeight(r);
      if (this.doc.y + h > this.bottom) {
        this.addPage();
        if (!header) drawRow(rows[0], true);
      }
      const y = this.doc.y;
      if (header) this.doc.rect(this.left, y, this.width, h).fillColor(COLORS.brandSoft).fill();
      let x = this.left;
      widths.forEach((w, c) => {
        this.doc.y = y + pad;
        this.text(r[c] ?? '', {
          x: x + pad,
          width: w - pad * 2,
          size,
          font: header ? 'bold' : 'regular',
          color: header ? COLORS.brandDark : COLORS.text,
          align: rtl ? 'right' : undefined,
        });
        x += w;
      });
      this.doc.moveTo(this.left, y + h).lineTo(this.right, y + h).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
      this.doc.y = y + h;
    };
    rows.forEach((r, i) => drawRow(r, i === 0));
    this.doc.y += 8;
  }

  /** Running header and footer on every page but the first `skip`. */
  finish(o: { title: string; skip?: number; subtitle?: string; noHeaderOnFirst?: boolean }) {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    const total = range.count - (o.skip ?? 0);
    for (let i = range.start + (o.skip ?? 0); i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const w = doc.page.width;
      const h = doc.page.height;
      if (!(o.noHeaderOnFirst && i === range.start)) {
        const title = o.title.length > 80 ? `${o.title.slice(0, 79)}…` : o.title;
        doc.y = 30;
        this.text(title, { size: 7.5, color: COLORS.faint, width: (w - 100) * 0.7, align: 'left' });
        this.use('regular', 7.5, COLORS.faint);
        doc.text(o.subtitle ?? 'DetectKB', this.left, 30, { width: w - 100, align: 'right', lineBreak: false });
        doc.moveTo(this.left, 44).lineTo(w - 50, 44).lineWidth(0.5).strokeColor(COLORS.rule).stroke();
      }
      this.use('regular', 7.5, COLORS.faint);
      doc.text(`${i - range.start - (o.skip ?? 0) + 1} / ${total}`, this.left, h - 38, { width: w - 100, align: 'right', lineBreak: false });
      doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, this.left, h - 38, { width: w - 100, lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
  }

  /** Writes the document; resolves with the file path. */
  save(filePath: string): Promise<string> {
    const stream = fs.createWriteStream(filePath);
    this.doc.pipe(stream);
    this.doc.end();
    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    });
  }
}
