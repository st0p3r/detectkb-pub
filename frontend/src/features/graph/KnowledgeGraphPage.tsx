import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-2d';
import { ExternalLink, Loader2, Network, Search, X } from 'lucide-react';
import { getGraph, type GraphNode } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { cn } from '@/lib/utils';

// Non-page node groups; page nodes use their page-type colour
const GROUPS: Record<string, { label: string; color: string }> = {
  technique: { label: 'ATT&CK techniques', color: '#8b5cf6' },
  sysmon: { label: 'Sysmon events', color: '#6366f1' },
  lolbas: { label: 'LOLBAS', color: '#f97316' },
  gtfobins: { label: 'GTFOBins', color: '#16a34a' },
  loldrivers: { label: 'LOLDrivers', color: '#dc2626' },
  category: { label: 'Categories', color: '#14b8a6' },
  tag: { label: 'Tags', color: '#94a3b8' },
};
const HIDDEN_BY_DEFAULT = new Set(['tag']);

type GNode = NodeObject & GraphNode & { degree: number };
type GLink = { source: string | GNode; target: string | GNode; kind: string };

const endId = (end: string | GNode) => (typeof end === 'string' ? end : String(end.id));

function cssColor(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `hsl(${v})` : fallback;
}

/** Interactive graph of pages, wiki links, ATT&CK techniques, Sysmon events and attacker tools. */
export default function KnowledgeGraphPage() {
  const navigate = useNavigate();
  const { getLabelFor, getColorFor } = usePageTypes();
  const { data, isLoading } = useQuery({ queryKey: ['graph'], queryFn: getGraph });
  const graphRef = useRef<ForceGraphMethods<GNode, GLink>>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hidden, setHidden] = useState<Set<string>>(HIDDEN_BY_DEFAULT);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState(0); // 0 = whole graph
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  // Positions survive filter changes so the layout doesn't jump; the view is
  // re-fitted once the simulation settles after every change.
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

  const isPage = (group: string) => !(group in GROUPS);
  const colorOf = useCallback((group: string) => (isPage(group) ? getColorFor(group) : GROUPS[group].color), [getColorFor]);

  // Adjacency over the full graph
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of data?.edges ?? []) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [data]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data?.nodes ?? []) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return counts;
  }, [data]);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as GNode[], links: [] as GLink[] };
    let visible = new Set(data.nodes.filter((n) => !hidden.has(n.group)).map((n) => n.id));
    if (selected && focusDepth > 0) {
      const keep = new Set([selected]);
      let frontier = [selected];
      for (let d = 0; d < focusDepth; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of neighbours.get(id) ?? []) {
            if (!keep.has(nb) && visible.has(nb)) {
              keep.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
      }
      visible = keep;
    }
    const links = data.edges.filter((e) => visible.has(e.source) && visible.has(e.target)).map((e) => ({ ...e }));
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    const nodes: GNode[] = data.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => ({ ...n, ...positions.current.get(n.id), degree: degree.get(n.id) ?? 0 }));
    fitPending.current = true;
    return { nodes, links };
  }, [data, hidden, selected, focusDepth, neighbours]);

  const selectedNode = data?.nodes.find((n) => n.id === selected) ?? null;
  const highlight = useMemo(() => {
    const center = hovered ?? selected;
    return center ? new Set([center, ...(neighbours.get(center) ?? [])]) : null;
  }, [hovered, selected, neighbours]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return [];
    return data.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [search, data]);

  function select(id: string) {
    setSelected(id);
    setSearch('');
    const node = graphData.nodes.find((n) => n.id === id);
    if (node && node.x !== undefined && node.y !== undefined) {
      graphRef.current?.centerAt(node.x, node.y, 600);
      graphRef.current?.zoom(2.5, 600);
    }
  }

  const drawNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = 3 + Math.min(Math.sqrt(node.degree) * 1.6, 10);
      const dimmed = highlight && !highlight.has(String(node.id));
      ctx.globalAlpha = dimmed ? 0.15 : 1;
      ctx.beginPath();
      if (isPage(node.group)) ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      else ctx.rect(node.x! - r, node.y! - r, r * 2, r * 2); // squares for non-page entities
      ctx.fillStyle = colorOf(node.group);
      ctx.fill();
      if (node.id === selected) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = cssColor('--foreground', '#111');
        ctx.stroke();
      }
      const showLabel = scale > 1.6 || node.id === selected || node.id === hovered || (highlight?.has(String(node.id)) ?? false);
      if (showLabel && !dimmed) {
        const fontSize = Math.max(10 / scale, 2);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = cssColor('--foreground', '#111');
        const label = node.label.length > 40 ? `${node.label.slice(0, 38)}…` : node.label;
        ctx.fillText(label, node.x!, node.y! + r + 1);
      }
      ctx.globalAlpha = 1;
    },
    [highlight, selected, hovered, colorOf]
  );

  const pageGroups = Array.from(groupCounts.keys()).filter(isPage).sort();
  const otherGroups = Object.keys(GROUPS).filter((g) => groupCounts.has(g));

  function toggleGroup(group: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <Breadcrumbs items={[{ label: 'Knowledge Graph' }]} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Network className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <span className="text-sm text-muted-foreground">
          {graphData.nodes.length} nodes · {graphData.links.length} connections
        </span>
        <div className="relative ml-auto w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a node…"
            aria-label="Find a node"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
          {searchResults.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg py-1 text-sm">
              {searchResults.map((n) => (
                <li key={n.id}>
                  <button onClick={() => select(n.id)} className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                    <span className="truncate">{n.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Node types">
        {[...pageGroups, ...otherGroups].map((g) => (
          <button
            key={g}
            onClick={() => toggleGroup(g)}
            aria-pressed={!hidden.has(g)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-opacity',
              hidden.has(g) ? 'opacity-40 border-border' : 'border-border bg-card'
            )}
          >
            <span className={cn('w-2.5 h-2.5', isPage(g) ? 'rounded-full' : 'rounded-sm')} style={{ backgroundColor: colorOf(g) }} />
            {isPage(g) ? getLabelFor(g) : GROUPS[g].label}
            <span className="text-muted-foreground">{groupCounts.get(g)}</span>
          </button>
        ))}
      </div>

      <div className="relative flex-1 min-h-[400px] rounded-lg border border-border bg-card overflow-hidden">
        <div ref={wrapRef} className="absolute inset-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Building graph…
            </div>
          ) : !graphData.nodes.length ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Nothing to show yet.</div>
          ) : (
            <ForceGraph2D<GNode, GLink>
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
                ctx.arc(node.x!, node.y!, 8, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={(l) => {
                const on = highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target));
                return on ? 'rgba(99,102,241,0.8)' : highlight ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.35)';
              }}
              linkDirectionalArrowLength={(l) => (l.kind === 'link' ? 3 : 0)}
              linkDirectionalArrowRelPos={1}
              onNodeHover={(n) => setHovered(n ? String(n.id) : null)}
              onNodeClick={(n) => setSelected(String(n.id))}
              onBackgroundClick={() => setSelected(null)}
              cooldownTicks={150}
              onEngineStop={() => {
                for (const n of graphData.nodes) {
                  if (n.x !== undefined && n.y !== undefined) positions.current.set(String(n.id), { x: n.x, y: n.y });
                }
                if (fitPending.current) {
                  fitPending.current = false;
                  graphRef.current?.zoomToFit(400, 40);
                }
              }}
            />
          )}
        </div>

        {selectedNode && (
          <div className="absolute top-3 right-3 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg p-4 text-sm">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="text-xs text-muted-foreground">
                  {isPage(selectedNode.group) ? getLabelFor(selectedNode.group) : GROUPS[selectedNode.group]?.label}
                </div>
                <div className="font-semibold">{selectedNode.label}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="p-1 rounded hover:bg-accent">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedNode.slug && (
                <button onClick={() => navigate(`/pages/${selectedNode.slug}`)} className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs">
                  Open page
                </button>
              )}
              {selectedNode.url && (
                <a href={selectedNode.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs">
                  ATT&CK <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {selectedNode.group === 'sysmon' && (
                <Link to={`/sysmon-events?event=${selectedNode.id.split(':')[1]}`} className="px-2.5 py-1 rounded-md border border-border text-xs">
                  Sysmon reference
                </Link>
              )}
              {['lolbas', 'gtfobins', 'loldrivers'].includes(selectedNode.group) && (
                <Link
                  to={`/attacker-tools?kind=${selectedNode.group}&key=${encodeURIComponent(selectedNode.id.split(':').slice(1).join(':'))}`}
                  className="px-2.5 py-1 rounded-md border border-border text-xs"
                >
                  Tool reference
                </Link>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs mb-3">
              Show
              <select value={focusDepth} onChange={(e) => setFocusDepth(Number(e.target.value))} className="px-1.5 py-0.5 rounded border border-border bg-background">
                <option value={0}>whole graph</option>
                <option value={1}>direct neighbours</option>
                <option value={2}>2 hops</option>
              </select>
            </label>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Connected ({neighbours.get(selectedNode.id)?.size ?? 0})
            </div>
            <ul className="space-y-0.5">
              {Array.from(neighbours.get(selectedNode.id) ?? [])
                .map((id) => data!.nodes.find((n) => n.id === id)!)
                .filter(Boolean)
                .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
                .map((n) => (
                  <li key={n.id}>
                    <button onClick={() => select(n.id)} className="w-full text-left flex items-center gap-2 px-1 py-0.5 rounded hover:bg-accent">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                      <span className="truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
