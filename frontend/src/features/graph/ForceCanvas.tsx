import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import type { GraphEdge, GraphMoreNode, GraphNode } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { ENTITY_GROUPS, cssColor, isPageGroup } from './graphStyle';

export type CanvasNode = (GraphNode | GraphMoreNode) & NodeObject;
type CanvasLink = { source: string | CanvasNode; target: string | CanvasNode; kind: string };

const endId = (end: string | CanvasNode) => (typeof end === 'string' ? end : String(end.id));
// Small graphs would otherwise be zoomed in until a handful of nodes fill the screen
const MAX_FIT_ZOOM = 2.2;

interface ForceCanvasProps {
  nodes: (GraphNode | GraphMoreNode)[];
  edges: GraphEdge[];
  selectedId: string | null;
  /** Nodes whose neighbours are loaded (drawn with a ring). */
  expandedIds?: Set<string>;
  /** Always label every node (small graphs). */
  alwaysLabel?: boolean;
  onNodeClick: (node: CanvasNode) => void;
  onBackgroundClick?: () => void;
}

/**
 * Force-directed canvas shared by the Wiki and Explore views. Positions are
 * kept across updates (new nodes spawn next to a neighbour) and the view is
 * re-fitted when the set of nodes changes.
 */
export function ForceCanvas({ nodes, edges, selectedId, expandedIds, alwaysLabel, onNodeClick, onBackgroundClick }: ForceCanvasProps) {
  const { getColorFor } = usePageTypes();
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
    charge?.strength?.(nodes.length > 300 ? -40 : -160);
    const link = fg.d3Force('link') as { distance?: (d: number) => void } | undefined;
    link?.distance?.(nodes.length > 300 ? 30 : 60);
    fg.d3ReheatSimulation();
  }, [graphData, nodes.length]);

  const highlight = useMemo(() => {
    const center = hovered ?? selectedId;
    return center ? new Set([center, ...(neighbours.get(center) ?? [])]) : null;
  }, [hovered, selectedId, neighbours]);

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
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, node.group === 'more' ? 14 : 9, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l) => {
          const on = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
          if (l.kind === 'more') return 'rgba(148,163,184,0.5)';
          return on ? 'rgba(99,102,241,0.85)' : highlight ? 'rgba(148,163,184,0.07)' : 'rgba(148,163,184,0.45)';
        }}
        linkLineDash={(l) => (l.kind === 'more' ? [2, 2] : null)}
        linkWidth={(l) => (highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target)) ? 1.6 : 0.8)}
        linkDirectionalArrowLength={(l) => (l.kind === 'link' ? 3.5 : 0)}
        linkDirectionalArrowRelPos={1}
        onNodeHover={(n) => setHovered(n && n.group !== 'more' ? String(n.id) : null)}
        onNodeClick={onNodeClick}
        onBackgroundClick={onBackgroundClick}
        cooldownTicks={120}
        onEngineStop={() => {
          for (const n of graphData.nodes) {
            if (n.x !== undefined && n.y !== undefined) positions.current.set(String(n.id), { x: n.x, y: n.y });
          }
          if (fitPending.current) {
            fitPending.current = false;
            const fg = graphRef.current;
            fg?.zoomToFit(0, 60);
            const z = fg?.zoom() ?? 1;
            if (z > MAX_FIT_ZOOM) fg?.zoom(MAX_FIT_ZOOM, 300);
          }
        }}
      />
    </div>
  );
}
