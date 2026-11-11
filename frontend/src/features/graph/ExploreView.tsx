import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, EyeOff, GitBranch, HelpCircle as CircleHelp, Loader2, LocateFixed, RotateCcw, Route, Undo2, X } from 'lucide-react';
import {
  apiErrorMessage,
  getGraphHubs,
  getGraphNeighbours,
  searchGraph,
  type GraphEdge,
  type GraphMoreNode,
  type GraphNode,
} from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import { useToast } from '@/hooks/useToast';
import { ForceCanvas, type CanvasNode } from './ForceCanvas';
import { NodePanel } from './NodePanel';
import { GroupChip, NodeSearch } from './GraphBits';
import { useGroupStyle } from './useGroupStyle';

const PAGE_SIZE = 25;
/** How many steps "Undo" can go back. */
const MAX_HISTORY = 30;
const HELP_KEY = 'detectkb.graphHelp';
const edgeKey = (e: GraphEdge) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`);

type AnyNode = GraphNode | GraphMoreNode;
interface Snapshot {
  nodes: Map<string, AnyNode>;
  edges: Map<string, GraphEdge>;
  /** Expanded nodes in the order they were opened: the trail */
  trail: string[];
}
const EMPTY: Snapshot = { nodes: new Map(), edges: new Map(), trail: [] };

interface ExploreViewProps {
  focusId: string | null;
  onFocusChange: (id: string | null) => void;
  onShowChain: (technique: string) => void;
  onFindPaths: (from: string) => void;
}

/**
 * Starts from one node and grows on demand: clicking a node loads its
 * neighbours; big neighbour groups arrive as one card that opens when
 * clicked. Every step can be undone, and kinds of node can be hidden.
 */
export function ExploreView({ focusId, onFocusChange, onShowChain, onFindPaths }: ExploreViewProps) {
  const { toast } = useToast();
  const { colorOf, labelOf } = useGroupStyle();
  const [graph, setGraph] = useState<Snapshot>(EMPTY);
  const history = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [centerOn, setCenterOn] = useState<{ id: string; key: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 200);
  const [resetKey, setResetKey] = useState(0);
  // The reading tips: opened from a button, so they never cover the graph unasked (remembered per browser)
  const [showHelp, setShowHelp] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const setHelp = (on: boolean) => {
    setShowHelp(on);
    try {
      localStorage.setItem(HELP_KEY, on ? 'on' : 'off');
    } catch {
      // not remembered
    }
  };

  const { data: results = [], isFetching: searching } = useQuery({ queryKey: ['graph-search', q], queryFn: () => searchGraph(q), enabled: q.length >= 2 });
  const { data: hubs = [], isLoading: hubsLoading } = useQuery({ queryKey: ['graph-hubs'], queryFn: getGraphHubs, enabled: !focusId });

  /** Applies a change to the graph, remembering the state before it for Undo. */
  const change = useCallback((fn: (prev: Snapshot) => Snapshot, remember = true) => {
    setGraph((prev) => {
      if (remember) {
        history.current = [...history.current.slice(-(MAX_HISTORY - 1)), prev];
        setCanUndo(true);
      }
      return fn(prev);
    });
  }, []);

  const merged = (prev: Snapshot, newNodes: AnyNode[], newEdges: GraphEdge[], removeId?: string): Pick<Snapshot, 'nodes' | 'edges'> => {
    const nodes = new Map(prev.nodes);
    if (removeId) nodes.delete(removeId);
    for (const n of newNodes) nodes.set(n.id, n);
    const edges = new Map(prev.edges);
    if (removeId) for (const [k, e] of edges) if (e.source === removeId || e.target === removeId) edges.delete(k);
    for (const e of newEdges) edges.set(edgeKey(e), e);
    return { nodes, edges };
  };

  const expand = useCallback(
    async (id: string, remember = true) => {
      setLoading(true);
      try {
        const r = await getGraphNeighbours(id);
        change((prev) => ({ ...merged(prev, [r.center, ...r.nodes, ...r.more], r.edges), trail: prev.trail.includes(id) ? prev.trail : [...prev.trail, id] }), remember);
      } catch (err) {
        toast(apiErrorMessage(err, 'Could not load neighbours'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [change, toast]
  );

  async function loadMore(more: GraphMoreNode) {
    setLoading(true);
    try {
      const r = await getGraphNeighbours(more.center, { group: more.targetGroup, offset: more.offset, limit: PAGE_SIZE });
      change((prev) => ({ ...merged(prev, [...r.nodes, ...r.more], r.edges, more.id), trail: prev.trail }));
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not load more'), 'error');
    } finally {
      setLoading(false);
    }
  }

  // (Re)start from the focus node
  useEffect(() => {
    setGraph(EMPTY);
    history.current = [];
    setCanUndo(false);
    setHiddenGroups(new Set());
    setSelected(focusId);
    if (focusId) void expand(focusId, false);
  }, [focusId, expand, resetKey]);

  function undo() {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!prev) return;
    setGraph(prev);
    if (selected && !prev.nodes.has(selected)) setSelected(null);
  }

  function hide(id: string) {
    change((prev) => ({ ...merged(prev, [], [], id), trail: prev.trail.filter((t) => t !== id) }));
    setSelected(null);
  }

  function pick(id: string) {
    setSelected(id);
    setCenterOn((prev) => ({ id, key: (prev?.key ?? 0) + 1 }));
  }

  function onNodeClick(node: CanvasNode) {
    if (node.group === 'more') {
      void loadMore(node as GraphMoreNode);
      return;
    }
    const id = String(node.id);
    setSelected(id);
    if (!graph.trail.includes(id)) void expand(id);
  }

  // Esc closes the panel; Ctrl/⌘+Z takes back the last step
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === 'Escape') setSelected(null);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- undo reads refs and current state setters
  }, [selected]);

  const groupOf = (n: AnyNode) => (n.group === 'more' ? (n as GraphMoreNode).targetGroup : n.group);
  const expanded = useMemo(() => new Set(graph.trail), [graph.trail]);
  const allNodes = useMemo(() => Array.from(graph.nodes.values()), [graph.nodes]);
  // The start node always stays, whatever is hidden
  const nodeList = useMemo(() => allNodes.filter((n) => n.id === focusId || !hiddenGroups.has(groupOf(n))), [allNodes, hiddenGroups, focusId]);
  const edgeList = useMemo(() => {
    const ids = new Set(nodeList.map((n) => n.id));
    return Array.from(graph.edges.values()).filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [graph.edges, nodeList]);
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of allNodes) counts.set(groupOf(n), (counts.get(groupOf(n)) ?? 0) + (n.group === 'more' ? (n as GraphMoreNode).remaining : 1));
    return Array.from(counts).sort((a, b) => b[1] - a[1]);
  }, [allNodes]);

  const selectedNode = selected ? (graph.nodes.get(selected) as GraphNode | undefined) : undefined;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(edgeList.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])));
    return nodeList.filter((n): n is GraphNode => ids.has(n.id) && n.group !== 'more').sort((a, b) => a.label.localeCompare(b.label));
  }, [selected, edgeList, nodeList]);

  const hubGroups = useMemo(() => {
    const by = new Map<string, typeof hubs>();
    for (const h of hubs) by.set(h.group, [...(by.get(h.group) ?? []), h]);
    return Array.from(by);
  }, [hubs]);

  const toolBtn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-sm hover:bg-accent disabled:opacity-40 disabled:hover:bg-background';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <NodeSearch
          value={search}
          onChange={setSearch}
          options={results.map((n) => ({ id: n.id, label: n.label, color: colorOf(n.group), note: `${labelOf(n.group)} · ${n.degree}` }))}
          onPick={(id) => onFocusChange(id)}
          placeholder={focusId ? 'Start from another node…' : 'Start from a technique, rule, event, tool…'}
          ariaLabel="Start from a node"
          empty={searching || q !== search.trim() ? 'Searching…' : 'Nothing has that name'}
          className="w-80"
        />
        {focusId && (
          <>
            <button onClick={undo} disabled={!canUndo} title="Take back the last step (Ctrl+Z)" className={toolBtn}>
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
            <button onClick={() => setResetKey((k) => k + 1)} title="Back to the start node and its neighbours" className={toolBtn}>
              <RotateCcw className="w-3.5 h-3.5" /> Start over
            </button>
          </>
        )}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Loading" />}
        {focusId && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {nodeList.length} node{nodeList.length === 1 ? '' : 's'} · {edgeList.length} link{edgeList.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {focusId && graph.trail.length > 0 && (
        <nav aria-label="Trail" className="flex flex-wrap items-center gap-1 mb-2 text-xs">
          <span className="text-muted-foreground">Opened:</span>
          {graph.trail.map((id, i) => {
            const n = graph.nodes.get(id);
            if (!n) return null;
            return (
              <React.Fragment key={id}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50" />}
                <button
                  onClick={() => pick(id)}
                  title="Show it in the graph"
                  className={`inline-flex items-center gap-1 max-w-[14rem] px-2 py-0.5 rounded-full border ${id === selected ? 'border-primary text-primary' : 'border-border hover:bg-accent'}`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                  <span dir="auto" className="truncate">{n.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
      )}

      {focusId && legend.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {legend.map(([g, count]) => (
            <GroupChip
              key={g}
              label={labelOf(g)}
              color={colorOf(g)}
              count={count}
              active={!hiddenGroups.has(g)}
              onClick={() =>
                setHiddenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(g)) next.delete(g);
                  else next.add(g);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}

      <div className="relative flex-1 min-h-[420px] flex gap-3">
        <div data-graph-export className="relative flex-1 min-w-0 rounded-lg border border-border bg-card overflow-hidden">
          {!focusId ? (
            <div className="h-full overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-base font-semibold">Where do you want to start?</h2>
                <p className="mt-1 mb-5 text-sm text-muted-foreground">
                  Search above for any technique, rule, log event, tool or page — or pick one of the most connected ones below. Click a node to open what it is connected
                  to, step by step.
                </p>
                {hubsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </p>
                ) : hubGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing to start from yet: import rules or write pages first.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {hubGroups.map(([group, list]) => (
                      <section key={group} className="rounded-lg border border-border p-3">
                        <h3 className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorOf(group) }} />
                          {labelOf(group)}
                        </h3>
                        <ul>
                          {list.map((h) => (
                            <li key={h.id}>
                              <button onClick={() => onFocusChange(h.id)} className="w-full flex items-center gap-2 px-2 py-1 -mx-2 rounded-md text-sm text-left hover:bg-accent">
                                <span dir="auto" className="truncate flex-1">{h.label}</span>
                                <span className="text-xs text-muted-foreground tabular-nums" title="Connections">{h.degree.toLocaleString()}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <ForceCanvas
                nodes={nodeList}
                edges={edgeList}
                selectedId={selected}
                expandedIds={expanded}
                alwaysLabel={nodeList.length <= 60}
                variant="card"
                centerOn={centerOn}
                onNodeClick={onNodeClick}
                onBackgroundClick={() => setSelected(null)}
              />
              {showHelp ? (
                <div data-export-ignore className="absolute left-14 bottom-3 z-10 flex items-start gap-2 max-w-md px-3 py-2 rounded-md border border-border bg-card/95 shadow-sm text-xs text-muted-foreground leading-relaxed">
                  <ul className="space-y-0.5">
                    <li>Click a card to open what it is connected to.</li>
                    <li>The number on a card is how many connections it has; filled once opened.</li>
                    <li>A stacked card stands for a whole group: click to open it.</li>
                    <li>
                      <span className="text-red-600 dark:text-red-400">Red dashed</span>: no rule covers it.
                    </li>
                  </ul>
                  <button onClick={() => setHelp(false)} aria-label="Hide these tips" className="p-0.5 -mr-1 rounded hover:bg-accent shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  data-export-ignore
                  onClick={() => setHelp(true)}
                  aria-label="How to read this graph"
                  title="How to read this graph"
                  className="absolute left-14 bottom-3 z-10 h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-border bg-card/95 shadow-sm text-xs text-muted-foreground hover:text-foreground"
                >
                  <CircleHelp className="w-4 h-4" /> How to read this
                </button>
              )}
            </>
          )}
        </div>
        {selectedNode && (
          <NodePanel node={selectedNode} onClose={() => setSelected(null)} neighbours={neighbours} onSelectNeighbour={pick}>
            {selectedNode.group === 'technique' && (
              <button onClick={() => onShowChain(selectedNode.id.split(':')[1])} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs">
                <GitBranch className="w-3 h-3" /> Detection chain
              </button>
            )}
            <button onClick={() => onFindPaths(selectedNode.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
              <Route className="w-3 h-3" /> Find paths
            </button>
            {selectedNode.id !== focusId && (
              <>
                <button onClick={() => onFocusChange(selectedNode.id)} title="Clear the graph and start from this node" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
                  <LocateFixed className="w-3 h-3" /> Start from here
                </button>
                <button onClick={() => hide(selectedNode.id)} title="Take this node out of the picture (Undo brings it back)" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
                  <EyeOff className="w-3 h-3" /> Hide
                </button>
              </>
            )}
          </NodePanel>
        )}
      </div>
    </>
  );
}
