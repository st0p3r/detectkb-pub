import type { GraphMoreNode, GraphNode } from '@/lib/api';

// Card geometry in graph units (= screen px at zoom 1)
export const CARD_W = 216;
export const CARD_H = 58;
/** Below this zoom cards are drawn as compact icon tiles. */
export const CARD_MIN_SCALE = 0.55;
export const TILE = 22;

export const STATUS_COLORS: Record<string, string> = {
  production: '#10b981',
  testing: '#f59e0b',
  draft: '#94a3b8',
  deprecated: '#ef4444',
};

/** Colours of a cluster's breakdown bar (rule statuses, or gap / covered). */
export const BREAKDOWN_COLORS: Record<string, string> = { ...STATUS_COLORS, covered: '#10b981', gap: '#ef4444' };
export const GAP_COLOR = '#ef4444';
const BREAKDOWN_ORDER = ['production', 'testing', 'draft', 'deprecated', 'covered', 'gap'];

export function breakdownEntries(breakdown: Record<string, number> = {}) {
  return Object.entries(breakdown).sort((a, b) => BREAKDOWN_ORDER.indexOf(a[0]) - BREAKDOWN_ORDER.indexOf(b[0]));
}

/** "58 Rules", "34 LOLBAS", "12 ATT&CK techniques" */
function countLabel(n: number, label: string) {
  const plural = /s$/i.test(label) || label === label.toUpperCase() ? label : `${label}s`;
  return `${n} ${n === 1 ? label : plural}`;
}

/** Title / subtitle shown on a node card, derived from the node's group and label. */
export function cardText(node: GraphNode | GraphMoreNode, groupLabel: (g: string) => string) {
  if (node.group === 'more') {
    const m = node as GraphMoreNode;
    if (m.cluster) {
      const parts = breakdownEntries(m.breakdown).map(([k, v]) => `${v} ${k === 'gap' ? 'without rules' : k === 'covered' ? 'with rules' : k}`);
      return { title: countLabel(m.remaining, groupLabel(m.targetGroup)), subtitle: parts.join(' · ') || 'click to open' };
    }
    return { title: `${m.remaining} more`, subtitle: `${groupLabel(m.targetGroup)} · click to load` };
  }
  const n = node as GraphNode;
  const rules = n.ruleCount === undefined ? '' : n.gap ? ' · no rules' : ` · ${n.ruleCount} rule${n.ruleCount === 1 ? '' : 's'}`;
  switch (n.group) {
    case 'technique': {
      const [id, ...name] = n.label.split(' ');
      return { title: name.join(' ') || id, subtitle: `${id}${rules || ' · Technique'}` };
    }
    case 'sysmon': {
      const m = n.label.match(/^EID (\d+) (.*)$/);
      return m ? { title: m[2], subtitle: `Sysmon · EID ${m[1]}` } : { title: n.label, subtitle: 'Sysmon event' };
    }
    case 'lolbas':
    case 'gtfobins':
    case 'loldrivers': {
      const m = n.label.match(/^(.*) \(([^)]+)\)$/);
      return m ? { title: m[1], subtitle: `${m[2]}${rules}` } : { title: n.label, subtitle: `${groupLabel(n.group)}${rules}` };
    }
    case 'RULE':
      return { title: n.label, subtitle: [n.severity, n.status].filter(Boolean).join(' · ') || 'Rule' };
    default:
      return { title: n.label, subtitle: groupLabel(n.group) };
  }
}

/** Word-wraps text into at most `maxLines` lines; the last line is ellipsised. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(current);
    current = words[i];
  }
  lines.push(current);
  return lines.map((l, i) => (i === lines.length - 1 ? fitText(ctx, l, maxWidth) : l));
}

/** Trims text with an ellipsis to fit `maxWidth` in the current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

interface SimNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/**
 * d3-style force that keeps rectangular cards from overlapping by pushing
 * overlapping pairs apart along the axis of least overlap.
 */
export function rectCollide(width: number, height: number, padding = 18, strength = 1, iterations = 3) {
  let nodes: SimNode[] = [];
  const force = (alpha: number) => {
    const w = width + padding;
    const h = height + padding;
    for (let pass = 0; pass < iterations; pass++)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const ox = w - Math.abs(dx);
        const oy = h - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Positional correction (not only velocity) so overlaps resolve even as the simulation cools
        const k = strength * Math.max(alpha, 0.1);
        if (ox / w < oy / h) {
          const s = (dx < 0 ? -1 : 1) * ox * 0.5 * k;
          a.x = (a.x ?? 0) - s;
          b.x = (b.x ?? 0) + s;
        } else {
          const s = (dy < 0 ? -1 : 1) * oy * 0.5 * k;
          a.y = (a.y ?? 0) - s;
          b.y = (b.y ?? 0) + s;
        }
      }
    }
  };
  force.initialize = (ns: SimNode[]) => {
    nodes = ns;
  };
  return force;
}
