import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2, Route } from 'lucide-react';
import { apiErrorMessage, getGraphPaths, type GraphEdge, type GraphNode } from '@/lib/api';
import { NodePicker } from './NodePicker';
import { useGroupStyle } from './useGroupStyle';
import { cardText } from './nodeCard';

interface PathViewProps {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  onExplore: (id: string) => void;
}

const EXAMPLES: [string, string, string][] = [
  ['lolbas:certutil.exe', 'sysmon:3', 'certutil → network connections'],
  ['technique:T1003.001', 'lolbas:rundll32.exe', 'LSASS memory → rundll32'],
  ['sysmon:10', 'technique:T1055', 'Process access → process injection'],
];

/** How a step reads, from the node on its left to the one on its right */
const RELATION: Record<string, [forward: string, backward: string]> = {
  technique: ['detects', 'detected by'],
  reference: ['mentions', 'mentioned by'],
  'tool-technique': ['used for', 'done with'],
  subtechnique: ['sub-technique of', 'parent of'],
  link: ['links to', 'linked from'],
  tag: ['tagged', 'tags'],
  category: ['in category', 'contains'],
};

function relationLabel(edge: GraphEdge | undefined, left: string, leftNode: GraphNode, rightNode: GraphNode) {
  if (!edge) return '';
  const forward = edge.source === left;
  if (edge.kind === 'sysmon') {
    // Rules use an event; data sources (and other pages) provide it
    const page = forward ? leftNode : rightNode;
    const [f, b] = page.group === 'RULE' ? ['uses', 'used by'] : ['provides', 'provided by'];
    return forward ? f : b;
  }
  const words = RELATION[edge.kind];
  return words ? (forward ? words[0] : words[1]) : edge.kind;
}

/** Shortest paths between two nodes, along the detection model: how is this tool related to that technique? */
export function PathView({ from, to, onChange, onExplore }: PathViewProps) {
  const { colorOf, labelOf } = useGroupStyle();
  // Picked nodes; after a reload they come back from the path response
  const [picked, setPicked] = useState(new Map<string, GraphNode>());
  const [status, setStatus] = useState('');
  const [links, setLinks] = useState(false);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['graph-paths', from, to, status, links],
    queryFn: () => getGraphPaths(from!, to!, { status, links }),
    enabled: !!from && !!to,
  });
  useEffect(() => {
    if (data) setPicked((prev) => new Map([...prev, ...data.nodes.map((n) => [n.id, n] as const)]));
  }, [data]);

  const byId = new Map(data?.nodes.map((n) => [n.id, n]));
  const edgeOf = new Map(data?.edges.map((e) => [[e.source, e.target].sort().join('|'), e]));
  const pick = (id: string | null) => (id ? picked.get(id) ?? byId.get(id) ?? null : null);
  const choose = (which: 'from' | 'to') => (n: GraphNode | null) => {
    if (n) setPicked((prev) => new Map(prev).set(n.id, n));
    onChange(which === 'from' ? n?.id ?? null : from, which === 'to' ? n?.id ?? null : to);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <NodePicker label="From" value={pick(from)} onChange={choose('from')} />
        <button
          onClick={() => onChange(to, from)}
          disabled={!from && !to}
          title="Swap"
          aria-label="Swap from and to"
          className="p-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
        >
          <ArrowLeftRight className="w-4 h-4" />
        </button>
        <NodePicker label="To" value={pick(to)} onChange={choose('to')} />
        <div className="flex items-center gap-3 ml-auto">
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <label className="flex items-center gap-2 text-sm" title="Also step along [[wiki links]] and through concept, note and other pages">
            <input type="checkbox" checked={links} onChange={(e) => setLinks(e.target.checked)} className="w-4 h-4" />
            Use wiki links
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Rule status" className="px-2.5 py-1.5 rounded-md border border-border bg-background text-sm">
            <option value="">Active rules</option>
            <option value="production">Production</option>
            <option value="production,testing">Production + testing</option>
            <option value="draft,testing,production,deprecated">All, with deprecated</option>
          </select>
        </div>
      </div>

      <div data-graph-export className="flex-1 min-h-[420px] rounded-lg border border-border bg-card overflow-auto p-5">
        {!from || !to ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Route className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-md">
              Pick two nodes to see how they connect along the detection model: tools and the techniques they're used for,
              rules and the techniques they detect, the tools they mention and the Sysmon events they use, and the data
              sources that provide those events. Tags and categories are never used, and wiki links only if you turn them on.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map(([a, b, label]) => (
                <button key={label} onClick={() => onChange(a, b)} className="px-3 py-1.5 rounded-full border border-border text-sm hover:bg-accent">
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Finding paths…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{apiErrorMessage(error, 'Could not find paths')}</p>
        ) : !data?.paths.length ? (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>These two aren't connected within 6 steps along the detection model{status ? ' with rules of that status' : ''}.</p>
            {data?.linksWouldHelp && (
              <button onClick={() => setLinks(true)} className="text-primary hover:underline">
                They are connected through wiki links — show those paths
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {data.paths.length === 8 ? 'The first 8' : data.paths.length} shortest path{data.paths.length === 1 ? '' : 's'} ·{' '}
              {data.paths[0].length - 1} step{data.paths[0].length === 2 ? '' : 's'} · click a node to explore from it
            </p>
            <ol className="space-y-3">
              {data.paths.map((path, i) => (
                <li key={path.join('|')} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{i + 1}.</span>
                  {path.map((id, j) => {
                    const n = byId.get(id)!;
                    const prev = j > 0 ? path[j - 1] : null;
                    const { title, subtitle } = cardText(n, labelOf);
                    const end = j === 0 || j === path.length - 1;
                    return (
                      <React.Fragment key={id}>
                        {prev && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                            <span className="w-3 h-px bg-border" />
                            {relationLabel(edgeOf.get([prev, id].sort().join('|')), prev, byId.get(prev)!, n)}
                            <span className="w-3 h-px bg-border" />
                          </span>
                        )}
                        <button
                          onClick={() => onExplore(id)}
                          title={`${n.label} — explore from here`}
                          className={`flex items-center gap-2 max-w-[15rem] px-2.5 py-1.5 rounded-lg border text-left hover:shadow-md transition-shadow ${
                            end ? 'border-primary/50 bg-primary/5' : n.gap ? 'border-red-400 border-dashed' : 'border-border bg-background'
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{title}</span>
                            <span className={`block text-[11px] truncate ${n.gap ? 'text-red-500' : 'text-muted-foreground'}`}>{subtitle}</span>
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </>
  );
}
