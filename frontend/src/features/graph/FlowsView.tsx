import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ListFilter, Loader2, Unplug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiErrorMessage, getCoverageFlows, SOURCE_FORMAT_LABELS, type CoverageFlows, type FlowSource, type RuleSourceFormat } from '@/lib/api';
import { cn } from '@/lib/utils';

interface FlowsViewProps {
  tactic: string | null;
  onTacticChange: (tactic: string | null) => void;
  /** Open the impact view for a whole source or one event */
  onShowImpact: (lost: { sources?: string[]; events?: string[] }) => void;
  onShowChain: (technique: string) => void;
}

// Layout in SVG units; the SVG scales to the container width
const W = 1100;
const BAR = 14;
const LEFT_X = 250;
const RIGHT_X = W - 290;
const PAD = 6;
/** Every node gets room for its label, however few rules it has */
const MIN_H = 15;
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16', '#ef4444', '#06b6d4', '#a855f7'];
const NONE_COLOR = '#94a3b8';

interface Placed {
  id: string;
  label: string;
  rules: number;
  y: number;
  h: number;
  color: string;
}

/** Two-column Sankey layout: node height ∝ the rule counts flowing through it. */
function layout(flows: CoverageFlows, height: number) {
  const weight = (id: string, side: 'source' | 'target') => flows.links.filter((l) => l[side] === id).reduce((n, l) => n + l.rules, 0);
  // Scale so each column fits once small nodes are raised to MIN_H
  const fit = (items: { id: string }[], side: 'source' | 'target') => {
    const weights = items.map((it) => weight(it.id, side));
    let scale = (height - PAD * (items.length - 1)) / (weights.reduce((a, b) => a + b, 0) || 1);
    for (let i = 0; i < 5; i++) {
      const small = weights.filter((w) => w * scale < MIN_H);
      const big = weights.filter((w) => w * scale >= MIN_H).reduce((a, b) => a + b, 0) || 1;
      scale = Math.max((height - PAD * (items.length - 1) - small.length * MIN_H) / big, 0.01);
    }
    return scale;
  };
  const scale = Math.min(fit(flows.sources, 'source'), fit(flows.targets, 'target'));
  const place = (items: { id: string; label: string; rules: number }[], side: 'source' | 'target', color: (i: number, id: string) => string) => {
    let y = 0;
    return items.map((it, i): Placed => {
      const h = Math.max(weight(it.id, side) * scale, MIN_H);
      const p = { ...it, y, h, color: color(i, it.id) };
      y += h + PAD;
      return p;
    });
  };
  const left = place(flows.sources, 'source', (i, id) => (id === 'none' ? NONE_COLOR : PALETTE[i % PALETTE.length]));
  const right = place(flows.targets, 'target', () => '#64748b');
  const L = new Map(left.map((n) => [n.id, n]));
  const R = new Map(right.map((n) => [n.id, n]));

  // Stack each node's bands in the order of the node at the other end, so bands don't cross needlessly
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const links = [...flows.links]
    .sort((a, b) => L.get(a.source)!.y - L.get(b.source)!.y || R.get(a.target)!.y - R.get(b.target)!.y)
    .map((l) => ({ ...l, w: l.rules * scale }));
  const byTarget = [...links].sort((a, b) => R.get(a.target)!.y - R.get(b.target)!.y || L.get(a.source)!.y - L.get(b.source)!.y);
  const y1 = new Map<(typeof links)[number], number>();
  for (const l of byTarget) {
    const off = inOffset.get(l.target) ?? 0;
    y1.set(l, R.get(l.target)!.y + off);
    inOffset.set(l.target, off + l.w);
  }
  const bands = links.map((l) => {
    const off = outOffset.get(l.source) ?? 0;
    outOffset.set(l.source, off + l.w);
    return { ...l, y0: L.get(l.source)!.y + off, y1: y1.get(l)!, color: L.get(l.source)!.color };
  });
  return { left, right, bands };
}

function bandPath(y0: number, y1: number, w: number) {
  const x0 = LEFT_X + BAR;
  const x1 = RIGHT_X;
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + w} C${mx},${y1 + w} ${mx},${y0 + w} ${x0},${y0 + w} Z`;
}

/** Where a flow source leads: its reference page and its rules. */
function sourceLinks(s: FlowSource) {
  if (!s.key) return null;
  const key = s.key;
  if (s.kind === 'event') {
    return {
      reference: key.startsWith('sysmon:') ? `/sysmon-events?event=${key.slice(7)}` : `/log-sources?event=${encodeURIComponent(key)}`,
      rules: `/rules?telemetry=${encodeURIComponent(key)}`,
    };
  }
  return {
    reference: key === 'sysmon' ? '/sysmon-events' : `/log-sources?source=${encodeURIComponent(key)}`,
    rules: `/rules?telemetry=${encodeURIComponent(key)}`,
  };
}

/** Sankey: detections flowing from telemetry (log sources or events) to ATT&CK tactics (or a tactic's techniques). */
export function FlowsView({ tactic, onTacticChange, onShowImpact, onShowChain }: FlowsViewProps) {
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  // Rules with no telemetry link are one block; off by default so the sources are readable
  const [withoutTelemetry, setWithoutTelemetry] = useState(false);
  const [groupBy, setGroupBy] = useState<'source' | 'event'>('source');
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['graph-flows', status, source, tactic, withoutTelemetry, groupBy],
    queryFn: () =>
      getCoverageFlows({
        status: status || undefined,
        source: source || undefined,
        tactic: tactic ?? undefined,
        groupBy,
        withoutTelemetry: withoutTelemetry ? undefined : '0',
      }),
  });

  const height = Math.max(480, ((data && Math.max(data.sources.length, data.targets.length)) ?? 0) * (MIN_H + PAD + 4));
  const placed = useMemo(() => (data?.links.length ? layout(data, height) : null), [data, height]);
  const focus = hover ?? pinned;
  const lit = (b: { source: string; target: string }) => !focus || b.source === focus || b.target === focus;
  const pinnedSource = pinned ? data?.sources.find((s) => s.id === pinned && s.kind !== 'none') : null;
  const pinnedLinks = pinnedSource ? sourceLinks(pinnedSource) : null;
  const tacticLabel = tactic?.replace(/-/g, ' ');

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <nav className="flex items-center gap-1 text-sm">
          <button onClick={() => onTacticChange(null)} className={cn(tactic ? 'text-primary hover:underline' : 'font-semibold')}>
            Telemetry → tactics
          </button>
          {tactic && (
            <>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold capitalize">{tacticLabel} techniques</span>
            </>
          )}
        </nav>
        <div className="flex rounded-md border border-border p-0.5 text-xs ml-auto" role="group" aria-label="Left column">
          {(
            [
              ['source', 'By log source'],
              ['event', 'By event'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                setGroupBy(k);
                setPinned(null);
              }}
              aria-pressed={groupBy === k}
              className={cn('px-2.5 py-1 rounded', groupBy === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withoutTelemetry} onChange={(e) => setWithoutTelemetry(e.target.checked)} className="w-4 h-4" />
          Include rules without telemetry
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Rule status" className=" px-2.5 py-1.5 rounded-md border border-border bg-background text-sm">
          <option value="">Active rules</option>
          <option value="production">Production</option>
          <option value="production,testing">Production + testing</option>
          <option value="draft">Draft</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Rule source" className="px-2.5 py-1.5 rounded-md border border-border bg-background text-sm">
          <option value="">Any source</option>
          <option value="manual">Written here</option>
          {(Object.keys(SOURCE_FORMAT_LABELS) as RuleSourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {pinnedSource && (
        <div className="flex flex-wrap items-center gap-3 mb-3 rounded-lg border border-border bg-card px-4 py-2 text-sm">
          <span className="font-medium">{pinnedSource.label}</span>
          <span className="text-muted-foreground">{pinnedSource.rules} rules</span>
          {pinnedLinks && (
            <>
              <button
                onClick={() => onShowImpact(pinnedSource.kind === 'event' ? { events: [pinnedSource.key!] } : { sources: [pinnedSource.key!] })}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Unplug className="w-3.5 h-3.5" /> What if we lose {pinnedSource.kind === 'event' ? 'it' : 'the whole source'}?
              </button>
              <Link to={pinnedLinks.rules} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ListFilter className="w-3.5 h-3.5" /> Rules
              </Link>
              <Link to={pinnedLinks.reference} className="text-primary hover:underline">
                Reference
              </Link>
            </>
          )}
          <button onClick={() => setPinned(null)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not load flows')}</p>
        ) : !placed ? (
          <p className="text-sm text-muted-foreground">No rules match.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">
              {data!.rules.toLocaleString()} rules · band width = rules reading that {groupBy === 'source' ? 'log source' : 'event'} for that{' '}
              {tactic ? 'technique' : 'tactic'} (a rule with several sources or tactics counts in each)
              {groupBy === 'event' && ' · events with fewer than 3 rules are merged per source'} · hover to trace, click a source to pin it,{' '}
              {tactic ? 'click a technique for its detection chain' : 'click a tactic to see its techniques'}
            </p>
            <svg data-graph-export data-graph-svg viewBox={`0 0 ${W} ${height + 8}`} className="w-full h-auto select-none" role="img" aria-label="Detection flows">
              <g transform="translate(0,4)">
                {placed.bands.map((b) => (
                  <path
                    key={`${b.source}|${b.target}`}
                    d={bandPath(b.y0, b.y1, b.w)}
                    fill={b.color}
                    fillOpacity={lit(b) ? (focus ? 0.55 : 0.32) : 0.05}
                    className="transition-[fill-opacity] duration-150"
                  >
                    <title>{`${data!.sources.find((s) => s.id === b.source)?.label} → ${data!.targets.find((t) => t.id === b.target)?.label}: ${b.rules} rule${b.rules === 1 ? '' : 's'}`}</title>
                  </path>
                ))}
                {placed.left.map((n) => (
                  <g
                    key={n.id}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setPinned(pinned === n.id ? null : n.id)}
                  >
                    <rect x={LEFT_X} y={n.y} width={BAR} height={n.h} rx={2} fill={n.color} opacity={!focus || focus === n.id ? 1 : 0.35} />
                    <text x={LEFT_X - 8} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle" className="fill-foreground text-[12px]">
                      {n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label}
                      <tspan className="fill-muted-foreground"> {n.rules}</tspan>
                    </text>
                  </g>
                ))}
                {placed.right.map((n) => (
                  <g
                    key={n.id}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => (tactic ? onShowChain(n.id.split(':')[1]) : onTacticChange(n.id.split(':')[1]))}
                  >
                    <rect x={RIGHT_X} y={n.y} width={BAR} height={n.h} rx={2} fill="#475569" opacity={!focus || focus === n.id ? 1 : 0.35} />
                    <text x={RIGHT_X + BAR + 8} y={n.y + n.h / 2} dominantBaseline="middle" className="fill-foreground text-[12px]">
                      {n.label.length > 36 ? `${n.label.slice(0, 35)}…` : n.label}
                      <tspan className="fill-muted-foreground"> {n.rules}</tspan>
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </>
        )}
      </div>
    </div>
  );
}
