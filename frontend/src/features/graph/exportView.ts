import { toPng } from 'html-to-image';
import { cssColor } from './graphStyle';

// Saves the current graph view as an image for reports.

function download(href: string, fileName: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The element the current view marked for export (data-graph-export). */
export function exportTarget(): HTMLElement | SVGSVGElement | null {
  return document.querySelector('[data-graph-export]');
}

/** PNG of the view at 2× resolution, including content scrolled out of sight. */
export async function exportPng(fileName: string) {
  const el = exportTarget();
  if (!el) throw new Error('Nothing to export in this view');
  const box = el as HTMLElement;
  const width = box.scrollWidth || el.getBoundingClientRect().width;
  const height = box.scrollHeight || el.getBoundingClientRect().height;
  const url = await toPng(box, {
    pixelRatio: 2,
    // The web font's stylesheet is cross-origin and can't be read; the text
    // is rendered with the page's already loaded fonts either way
    skipFonts: true,
    backgroundColor: cssColor('--card', '#ffffff'),
    width,
    height,
    // The whole scrollable content, not just the visible part
    style: { overflow: 'visible', maxHeight: 'none', height: `${height}px`, width: `${width}px`, margin: '0' },
    filter: (node) => !(node instanceof HTMLElement && node.dataset.exportIgnore !== undefined),
  });
  download(url, fileName);
}

/**
 * A standalone vector SVG of an inline SVG view: colours set through CSS
 * classes and variables are resolved into attributes so it renders the same
 * outside the app (Inkscape, Word, a browser).
 */
export function exportSvg(fileName: string) {
  const svg = document.querySelector<SVGSVGElement>('svg[data-graph-svg]');
  if (!svg) throw new Error('This view has no vector image');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = svg.querySelectorAll('*');
  clone.querySelectorAll('*').forEach((node, i) => {
    const style = getComputedStyle(originals[i]);
    if (node instanceof SVGTextElement || node instanceof SVGTSpanElement) {
      node.setAttribute('fill', style.fill);
      node.setAttribute('font-size', style.fontSize);
      node.setAttribute('font-family', style.fontFamily);
    }
    node.removeAttribute('class');
  });
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 1000 600').split(/\s+/).map(Number);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.removeAttribute('class');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', cssColor('--card', '#ffffff'));
  clone.insertBefore(bg, clone.firstChild);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  download(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
