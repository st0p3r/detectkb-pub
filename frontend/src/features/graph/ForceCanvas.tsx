import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import type { GraphEdge, GraphMoreNode, GraphNode } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { ENTITY_GROUPS, cssColor, isPageGroup } from './graphStyle';
import { useNodeIcons } from './nodeIcons';
import { BREAKDOWN_COLORS, CARD_H, CARD_MIN_SCALE, CARD_W, GAP_COLOR, STATUS_COLORS, TILE, breakdownEntries, cardText, fitText, rectCollide, wrapText } from './nodeCard';

export type CanvasNode = (GraphNode | GraphMoreNode) & NodeObject;
type CanvasLink = { source: string | CanvasNode; target: string | CanvasNode; kind: string };

const endId = (end: string | CanvasNode) => (typeof end === 'string' ? end : String(end.id));
// Small graphs would otherwise be zoomed in until a handful of nodes fill the screen
const MAX_FIT_ZOOM = 2.2;
const MAX_FIT_ZOOM_CARDS = 1.25;

interface ForceCanvasProps {
  nodes: (GraphNode | GraphMoreNode)[];
  edges: GraphEdge[];
  selectedId: string | null;
  /** Nodes whose neighbours are loaded (drawn with a ring). */
  expandedIds?: Set<string>;
  /** Always label every node (small graphs). */
  alwaysLabel?: boolean;
  /** 'card': rounded cards with icon, title and subtitle; 'dot': circles/squares (large graphs). */
  variant?: 'dot' | 'card';
  onNodeClick: (node: CanvasNode) => void;
  onBackgroundClick?: () => void;
}

/**
 * Force-directed canvas shared by the Wiki and Explore views. Positions are
 * kept across updates (new nodes spawn next to a neighbour) and the view is
 * re-fitted when the set of nodes changes.
 */
export function ForceCanvas({ nodes, edges, selectedId, expandedIds, alwaysLabel, variant = 'dot', onNodeClick, onBackgroundClick }: ForceCanvasProps) {
  const { getColorFor, getLabelFor } = usePageTypes();
  const cards = variant === 'card';
  const graphRef = useRef<ForceGraphMethods<CanvasNode, CanvasLink>>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const fitPending = useRef(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colorOf = useCallback((group: string) => (isPageGroup(group) ? getColorFor(group) : ENTITY_GROUPS[group].color), [getColorFor]);
  const groupLabel = useCallback(
    (group: string) => (isPageGroup(group) ? getLabelFor(group) : ENTITY_GROUPS[group]?.label ?? group),
    [getLabelFor]
  );
  // White icons for the coloured badges; "more" cards use a coloured icon on the card
  const icons = useNodeIcons(
    cards
      ? nodes.map((n) =>
          n.group === 'more'
            ? { group: 'more', color: colorOf((n as GraphMoreNode).targetGroup) }
            : { group: n.group, color: '#ffffff' }
        )
      : []
  );

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [edges]);

  // Label the most connected nodes even when zoomed out
  const hubThreshold = useMemo(() => {
    const degrees = nodes.map((n) => n.degree).sort((a, b) => b - a);
    return degrees[Math.min(degrees.length - 1, Math.max(4, Math.floor(degrees.length * 0.05)))] ?? Infinity;
  }, [nodes]);

  const graphData = useMemo(() => {
    const placed = (id: string) => positions.current.get(id);
    const data = {
      nodes: nodes.map((n) => {
        let pos = placed(n.id);
        if (!pos) {
          // Spawn next to an already placed neighbour instead of at the origin
          const anchor = Array.from(neighbours.get(n.id) ?? []).map(placed).find(Boolean);
          if (anchor) pos = { x: anchor.x + (Math.random() - 0.5) * 40, y: anchor.y + (Math.random() - 0.5) * 40 };
        }
        return { ...n, ...pos } as CanvasNode;
      }),
      links: edges.map((e) => ({ ...e })) as CanvasLink[],
    };
    fitPending.current = true;
    return data;
  }, [nodes, edges, neighbours]);

  // More spacing than the d3 defaults so labels have room
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as { strength?: (s: number) => void } | undefined;
    charge?.strength?.(cards ? -420 : nodes.length > 300 ? -40 : -160);
    const link = fg.d3Force('link') as { distance?: (d: number) => void } | undefined;
    link?.distance?.(cards ? 170 : nodes.length > 300 ? 30 : 60);
    fg.d3Force('collide', cards ? (rectCollide(CARD_W, CARD_H) as never) : null);
    fg.d3ReheatSimulation();
  }, [graphData, nodes.length, cards]);

  const highlight = useMemo(() => {
    const center = hovered ?? selectedId;
    return center ? new Set([center, ...(neighbours.get(center) ?? [])]) : null;
  }, [hovered, selectedId, neighbours]);

  const drawCard = useCallback(
    (node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const id = String(node.id);
      const x = node.x!;
      const y = node.y!;
      const isMore = node.group === 'more';
      const cluster = isMore && !!(node as GraphMoreNode).cluster;
      // "+N more" pills are dashed; clusters are solid cards standing for a group
      const dashed = isMore && !cluster;
      const gap = !isMore && !!(node as GraphNode).gap;
      const color = colorOf(isMore ? (node as GraphMoreNode).targetGroup : node.group);
      const selected = id === selectedId;
      const hot = selected || id === hovered;
      const dimmed = highlight && !highlight.has(id);
      const card = cssColor('--card', '#fff');
      const fg = cssColor('--foreground', '#111');
      const muted = cssColor('--muted-foreground', '#64748b');
      const border = cssColor('--border', '#e2e8f0');
      const primary = cssColor('--primary', '#4f46e5');
      const icon = icons?.get(isMore ? `more|${color}` : `${node.group}|#ffffff`);
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.18 : 1;

      if (scale < CARD_MIN_SCALE && !hot) {
        // Zoomed out: compact icon tile, constant size on screen
        const t = TILE / scale;
        ctx.beginPath();
        ctx.roundRect(x - t / 2, y - t / 2, t, t, 6 / scale);
        ctx.fillStyle = isMore ? card : color;
        ctx.fill();
        if (gap) {
          ctx.setLineDash([3 / scale, 2 / scale]);
          ctx.lineWidth = 2 / scale;
          ctx.strokeStyle = GAP_COLOR;
          ctx.stroke();
        } else if (isMore) {
          ctx.setLineDash([3 / scale, 2 / scale]);
          ctx.lineWidth = 1 / scale;
          ctx.strokeStyle = color;
          ctx.stroke();
        }
        if (icon?.complete) ctx.drawImage(icon, x - 7 / scale, y - 7 / scale, 14 / scale, 14 / scale);
        ctx.restore();
        return;
      }

      const left = x - CARD_W / 2;
      const top = y - CARD_H / 2;
      ctx.beginPath();
      ctx.roundRect(left, top, CARD_W, CARD_H, 10);
      ctx.shadowColor = hot ? 'rgba(15,23,42,0.22)' : 'rgba(15,23,42,0.10)';
      ctx.shadowBlur = hot ? 16 : 8;
      ctx.shadowOffsetY = hot ? 4 : 2;
      ctx.fillStyle = card;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      if (dashed || gap) ctx.setLineDash([4, 3]);
      ctx.lineWidth = selected ? 2 : gap || cluster ? 1.5 : 1;
      ctx.strokeStyle = selected ? primary : gap ? GAP_COLOR : hot || isMore ? color : border;
      ctx.stroke();
      ctx.setLineDash([]);
      if (cluster) {
        // Second card edge behind: a stack of cards
        ctx.beginPath();
        ctx.moveTo(left + 8, top + CARD_H + 3);
        ctx.lineTo(left + CARD_W - 8, top + CARD_H + 3);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
      }

      // Icon badge, vertically centred
      ctx.beginPath();
      ctx.roundRect(left + 9, y - 16, 32, 32, 9);
      ctx.fillStyle = isMore ? `${color}22` : color;
      ctx.fill();
      if (icon?.complete) ctx.drawImage(icon, left + 16, y - 9, 18, 18);

      // Title (up to two lines) and subtitle, centred as a block
      const { title, subtitle } = cardText(node, groupLabel);
      const textLeft = left + 50;
      const hasBadge = !isMore && node.degree > 0;
      const textWidth = CARD_W - 58 - (hasBadge ? 28 : 0);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const lines = wrapText(ctx, title, textWidth, 2);
      const blockTop = y - (lines.length * 13 + 13) / 2 - (cluster ? 3 : 0);
      ctx.fillStyle = fg;
      lines.forEach((line, i) => ctx.fillText(line, textLeft, blockTop + 10 + i * 13));
      const subBase = blockTop + lines.length * 13 + 10;
      ctx.font = '10px Inter, system-ui, sans-serif';
      let subLeft = textLeft;
      const status = (node as GraphNode).status;
      if (status) {
        ctx.beginPath();
        ctx.arc(textLeft + 3.5, subBase - 3.5, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = STATUS_COLORS[status] ?? '#94a3b8';
        ctx.fill();
        subLeft += 11;
      }
      ctx.fillStyle = gap ? GAP_COLOR : muted;
      ctx.fillText(fitText(ctx, subtitle, CARD_W - 58 - (subLeft - textLeft)), subLeft, subBase);

      if (cluster) {
        // Breakdown bar: statuses of the rules, or tools with / without rules
        const entries = breakdownEntries((node as GraphMoreNode).breakdown);
        const total = entries.reduce((n, [, v]) => n + v, 0) || 1;
        const barW = CARD_W - 58;
        let bx = textLeft;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(textLeft, subBase + 5, barW, 4, 2);
        ctx.clip();
        for (const [k, v] of entries) {
          const w = (v / total) * barW;
          ctx.fillStyle = BREAKDOWN_COLORS[k] ?? '#94a3b8';
          ctx.fillRect(bx, subBase + 5, w, 4);
          bx += w;
        }
        ctx.restore();
      }

      // Connection count: filled once the node's neighbours are loaded
      if (hasBadge) {
        const label = node.degree > 999 ? '999+' : String(node.degree);
        ctx.font = '600 9px Inter, system-ui, sans-serif';
        const bw = Math.max(20, ctx.measureText(label).width + 10);
        const bx = left + CARD_W - bw - 8;
        const by = top + 8;
        const expanded = expandedIds?.has(id);
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 16, 8);
        ctx.fillStyle = expanded ? color : card;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.fillStyle = expanded ? '#ffffff' : color;
        ctx.textAlign = 'center';
        ctx.fillText(label, bx + bw / 2, by + 11.5);
      }
      ctx.restore();
    },
    [colorOf, groupLabel, icons, selectedId, hovered, highlight, expandedIds]
  );

  const drawNode = useCallback(
    (node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const id = String(node.id);
      const dimmed = highlight && !highlight.has(id);
      const fg = cssColor('--foreground', '#111');
      ctx.globalAlpha = dimmed ? 0.12 : 1;

      if (node.group === 'more') {
        // Pill: "+659 more", always labelled
        const fontSize = Math.max(11 / scale, 3);
        ctx.font = `${fontSize}px sans-serif`;
        const w = ctx.measureText(node.label).width + fontSize;
        const h = fontSize * 1.8;
        ctx.beginPath();
        ctx.roundRect(node.x! - w / 2, node.y! - h / 2, w, h, h / 2);
        ctx.fillStyle = cssColor('--card', '#fff');
        ctx.fill();
        ctx.setLineDash([3 / scale, 2 / scale]);
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = colorOf((node as GraphMoreNode).targetGroup);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x!, node.y!);
        ctx.globalAlpha = 1;
        return;
      }

      const r = 3.5 + Math.min(Math.sqrt(node.degree) * 1.4, 9);
      ctx.beginPath();
      if (isPageGroup(node.group)) ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      else ctx.rect(node.x! - r, node.y! - r, r * 2, r * 2);
      ctx.fillStyle = colorOf(node.group);
      ctx.fill();
      if (expandedIds?.has(id) || id === selectedId) {
        ctx.lineWidth = (id === selectedId ? 2.5 : 1.5) / scale;
        ctx.strokeStyle = fg;
        ctx.stroke();
      }
      const showLabel =
        alwaysLabel || scale > 1.4 || node.degree >= hubThreshold || id === selectedId || id === hovered || (highlight?.has(id) ?? false);
      if (showLabel && !dimmed) {
        const fontSize = Math.max(11 / scale, 2.5);
        ctx.font = `${id === selectedId ? 'bold ' : ''}${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = fg;
        const label = node.label.length > 42 ? `${node.label.slice(0, 40)}…` : node.label;
        ctx.fillText(label, node.x!, node.y! + r + 2 / scale);
      }
      ctx.globalAlpha = 1;
    },
    [highlight, selectedId, hovered, expandedIds, alwaysLabel, hubThreshold, colorOf]
  );

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <ForceGraph2D<CanvasNode, CanvasLink>
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        nodeId="id"
        nodeLabel={(n) => n.label}
        nodeCanvasObject={cards ? drawCard : drawNode}
        nodePointerAreaPaint={(node, color, ctx, scale) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          if (cards && scale >= CARD_MIN_SCALE) ctx.rect(node.x! - CARD_W / 2, node.y! - CARD_H / 2, CARD_W, CARD_H);
          else if (cards) ctx.rect(node.x! - TILE / scale / 2, node.y! - TILE / scale / 2, TILE / scale, TILE / scale);
          else ctx.arc(node.x!, node.y!, node.group === 'more' ? 14 : 9, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l) => {
          const on = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
          if (l.kind === 'more') return 'rgba(148,163,184,0.5)';
          return on ? 'rgba(99,102,241,0.85)' : highlight ? 'rgba(148,163,184,0.07)' : 'rgba(148,163,184,0.45)';
        }}
        linkLineDash={(l) => (l.kind === 'more' ? [2, 2] : null)}
        linkWidth={(l) => (highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target)) ? 1.6 : 0.8)}
        linkDirectionalArrowLength={(l) => (!cards && l.kind === 'link' ? 3.5 : 0)}
        linkCurvature={cards ? 0.12 : 0}
        linkDirectionalArrowRelPos={1}
        onNodeHover={(n) => setHovered(n && n.group !== 'more' ? String(n.id) : null)}
        onNodeClick={onNodeClick}
        onBackgroundClick={onBackgroundClick}
        cooldownTicks={cards ? 300 : 120}
        onEngineStop={() => {
          for (const n of graphData.nodes) {
            if (n.x !== undefined && n.y !== undefined) positions.current.set(String(n.id), { x: n.x, y: n.y });
          }
          if (fitPending.current) {
            fitPending.current = false;
            const fg = graphRef.current;
            if (!fg) return;
            if (cards) {
              // Fit the cards' real extent (zoomToFit only knows node centres)
              const xs = graphData.nodes.map((n) => n.x ?? 0);
              const ys = graphData.nodes.map((n) => n.y ?? 0);
              const minX = Math.min(...xs) - CARD_W / 2;
              const maxX = Math.max(...xs) + CARD_W / 2;
              const minY = Math.min(...ys) - CARD_H / 2;
              const maxY = Math.max(...ys) + CARD_H / 2;
              const margin = 24;
              const z = Math.min(size.width / (maxX - minX + 2 * margin), size.height / (maxY - minY + 2 * margin), MAX_FIT_ZOOM_CARDS);
              fg.centerAt((minX + maxX) / 2, (minY + maxY) / 2, 300);
              fg.zoom(z, 300);
            } else {
              fg.zoomToFit(0, 60);
              if (fg.zoom() > MAX_FIT_ZOOM) fg.zoom(MAX_FIT_ZOOM, 300);
            }
          }
        }}
      />
    </div>
  );
}
