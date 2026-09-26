import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, GitBranch, Loader2, RotateCcw, Search } from 'lucide-react';
import {
  apiErrorMessage,
  getGraphHubs,
  getGraphNeighbours,
  searchGraph,
  type GraphEdge,
  type GraphMoreNode,
  type GraphNode,
} from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { useToast } from '@/hooks/useToast';
import { ForceCanvas, type CanvasNode } from './ForceCanvas';
import { NodePanel } from './NodePanel';
import { ENTITY_GROUPS, isPageGroup } from './graphStyle';

const PAGE_SIZE = 25;
const edgeKey = (e: GraphEdge) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`);

interface ExploreViewProps {
  focusId: string | null;
  onFocusChange: (id: string | null) => void;
  onShowChain: (technique: string) => void;
}

/**
 * Starts from one node and grows on demand: clicking a node loads its
 * neighbours; big neighbour groups arrive as "+N more" nodes that load the
 * next page when clicked.
 */
export function ExploreView({ focusId, onFocusChange, onShowChain }: ExploreViewProps) {
  const { toast } = useToast();
  const { getLabelFor, getColorFor } = usePageTypes();
  const [nodes, setNodes] = useState(new Map<string, GraphNode | GraphMoreNode>());
  const [edges, setEdges] = useState(new Map<string, GraphEdge>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [resetKey, setResetKey] = useState(0);

  const { data: results = [] } = useQuery({
    queryKey: ['graph-search', search],
    queryFn: () => searchGraph(search),
    enabled: search.trim().length >= 2,
  });
  const { data: hubs = [] } = useQuery({ queryKey: ['graph-hubs'], queryFn: getGraphHubs, enabled: !focusId });

  const merge = useCallback((newNodes: (GraphNode | GraphMoreNode)[], newEdges: GraphEdge[], removeId?: string) => {
    setNodes((prev) => {
      const next = new Map(prev);
      if (removeId) next.delete(removeId);
      for (const n of newNodes) next.set(n.id, n);
      return next;
    });
    setEdges((prev) => {
      const next = new Map(prev);
      if (removeId) for (const [k, e] of next) if (e.source === removeId || e.target === removeId) next.delete(k);
      for (const e of newEdges) next.set(edgeKey(e), e);
      return next;
    });
  }, []);

  const expand = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const r = await getGraphNeighbours(id);
        merge([r.center, ...r.nodes, ...r.more], r.edges);
        setExpanded((prev) => new Set(prev).add(id));
      } catch (err) {
        toast(apiErrorMessage(err, 'Could not load neighbours'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [merge, toast]
  );

  async function loadMore(more: GraphMoreNode) {
    setLoading(true);
    try {
      const r = await getGraphNeighbours(more.center, { group: more.targetGroup, offset: more.offset, limit: PAGE_SIZE });
      merge([...r.nodes, ...r.more], r.edges, more.id);
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not load more'), 'error');
    } finally {
      setLoading(false);
    }
  }

  // (Re)start from the focus node
  useEffect(() => {
    setNodes(new Map());
    setEdges(new Map());
    setExpanded(new Set());
    setSelected(focusId);
    if (focusId) expand(focusId);
  }, [focusId, expand, resetKey]);

  function hide(id: string) {
    merge([], [], id);
    setSelected(null);
  }

  function onNodeClick(node: CanvasNode) {
    if (node.group === 'more') {
      loadMore(node as GraphMoreNode);
      return;
    }
    const id = String(node.id);
    setSelected(id);
    if (!expanded.has(id)) expand(id);
  }

  const nodeList = useMemo(() => Array.from(nodes.values()), [nodes]);
  const edgeList = useMemo(() => Array.from(edges.values()), [edges]);
  const selectedNode = selected ? (nodes.get(selected) as GraphNode | undefined) : undefined;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(edgeList.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])));
    return nodeList.filter((n): n is GraphNode => ids.has(n.id) && n.group !== 'more').sort((a, b) => a.label.localeCompare(b.label));
  }, [selected, edgeList, nodeList]);
  const colorOf = (g: string) => (isPageGroup(g) ? getColorFor(g) : ENTITY_GROUPS[g]?.color ?? '#94a3b8');
  const groupLabel = (g: string) => (isPageGroup(g) ? getLabelFor(g) : ENTITY_GROUPS[g]?.label ?? g);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Start from… (technique, rule, event, tool)"
            aria-label="Start from a node"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
          {search.trim().length >= 2 && results.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-lg py-1 text-sm">
              {results.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      setSearch('');
                      onFocusChange(n.id);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(n.group) }} />
                    <span className="truncate flex-1">{n.label}</span>
                    <span className="text-xs text-muted-foreground">{n.degree}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {focusId && (
          <button onClick={() => setResetKey((k) => k + 1)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-accent">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          Click a node to load its neighbours · click <span className="px-1.5 rounded-full border border-dashed">+N more</span> to load the next {PAGE_SIZE}
        </span>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="relative flex-1 min-h-[420px] rounded-lg border border-border bg-card overflow-hidden">
        {!focusId ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
            <p className="text-sm text-muted-foreground max-w-md">
              Pick a starting point — search above, or one of the most connected nodes in your knowledge base:
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-3xl">
              {hubs.map((h) => (
                <button
                  key={h.id}
                  onClick={() => onFocusChange(h.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-sm hover:bg-accent"
                  title={groupLabel(h.group)}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorOf(h.group) }} />
                  {h.label}
                  <span className="text-xs text-muted-foreground">{h.degree}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ForceCanvas
            nodes={nodeList}
            edges={edgeList}
            selectedId={selected}
            expandedIds={expanded}
            alwaysLabel={nodeList.length <= 60}
            variant="card"
            onNodeClick={onNodeClick}
            onBackgroundClick={() => setSelected(null)}
          />
        )}
        {selectedNode && (
          <NodePanel node={selectedNode} onClose={() => setSelected(null)} neighbours={neighbours} onSelectNeighbour={setSelected}>
            {selectedNode.group === 'technique' && (
              <button
                onClick={() => onShowChain(selectedNode.id.split(':')[1])}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs"
              >
                <GitBranch className="w-3 h-3" /> Detection chain
              </button>
            )}
            {selectedNode.id !== focusId && (
              <>
                <button onClick={() => onFocusChange(selectedNode.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
                  Start from here
                </button>
                <button onClick={() => hide(selectedNode.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-accent">
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
