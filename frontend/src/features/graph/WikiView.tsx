import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Compass, Layers, Loader2, Plus, Unlink } from 'lucide-react';
import { apiErrorMessage, getGraph, type GraphLayer } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { ForceCanvas } from './ForceCanvas';
import { NodePanel } from './NodePanel';
import { CheckMenu, GroupChip, NodeSearch } from './GraphBits';
import { ENTITY_GROUPS, isPageGroup } from './graphStyle';
import { useGroupStyle } from './useGroupStyle';

const OPTIONAL_LAYERS: { id: GraphLayer; label: string; color: string; hint?: string }[] = [
  { id: 'category', label: 'Categories', color: ENTITY_GROUPS.category.color },
  { id: 'tag', label: 'Tags', color: ENTITY_GROUPS.tag.color },
  { id: 'rules', label: 'Detection rules', color: '#4338ca', hint: 'Every rule: large, use it on a small knowledge base' },
  { id: 'technique', label: 'ATT&CK techniques', color: ENTITY_GROUPS.technique.color },
  { id: 'sysmon', label: 'Sysmon events', color: ENTITY_GROUPS.sysmon.color },
  { id: 'logs', label: 'Log events', color: ENTITY_GROUPS.logevent.color },
  { id: 'tools', label: 'Attacker tools', color: ENTITY_GROUPS.lolbas.color },
  { id: 'stories', label: 'Analytic stories', color: ENTITY_GROUPS.story.color },
  { id: 'groups', label: 'Threat groups', color: ENTITY_GROUPS['threat-group'].color },
  { id: 'software', label: 'Malware & tools', color: ENTITY_GROUPS.software.color },
  { id: 'mitigations', label: 'Mitigations', color: ENTITY_GROUPS.mitigation.color },
];
const LAYER_IDS = OPTIONAL_LAYERS.map((l) => l.id as string);
const DEFAULT_LAYERS = ['category'];
const HEAVY_NODES = 400;

/**
 * Obsidian-style view: knowledge pages (notes, concepts, data sources, …) and
 * their [[links]]. Other layers can be added. What is shown lives in the URL
 * (?layers=, ?hide=, ?linked=1), so a view can be shared or saved.
 */
export function WikiView({ onExplore }: { onExplore: (nodeId: string) => void }) {
  const { colorOf, labelOf } = useGroupStyle();
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const layers = useMemo(() => {
    const raw = params.get('layers');
    return (raw === null ? DEFAULT_LAYERS : raw.split(',')).filter((l) => LAYER_IDS.includes(l));
  }, [params]);
  const hidden = useMemo(() => new Set((params.get('hide') ?? '').split(',').filter(Boolean)), [params]);
  const linkedOnly = params.get('linked') === '1';
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true }
    );

  const [selected, setSelected] = useState<string | null>(null);
  const [centerOn, setCenterOn] = useState<{ id: string; key: number } | null>(null);
  const [find, setFind] = useState('');
  const queryLayers = useMemo(() => ['pages', ...layers] as GraphLayer[], [layers]);
  const { data, isLoading, error } = useQuery({ queryKey: ['graph', queryLayers], queryFn: () => getGraph(queryLayers), placeholderData: (prev) => prev });

  // Kinds of node present, with how many of each (page types first)
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data?.nodes ?? []) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return Array.from(counts).sort((a, b) => Number(isPageGroup(b[0])) - Number(isPageGroup(a[0])) || labelOf(a[0]).localeCompare(labelOf(b[0])));
  }, [data, labelOf]);

  const view = useMemo(() => {
    let nodes = (data?.nodes ?? []).filter((n) => !hidden.has(n.group));
    let ids = new Set(nodes.map((n) => n.id));
    const edges = (data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    const unlinked = nodes.filter((n) => !linked.has(n.id)).length;
    if (linkedOnly) {
      nodes = nodes.filter((n) => linked.has(n.id));
      ids = new Set(nodes.map((n) => n.id));
    }
    return { nodes, edges, unlinked };
  }, [data, hidden, linkedOnly]);

  const selectedNode = view.nodes.find((n) => n.id === selected) ?? null;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(view.edges.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])));
    return view.nodes.filter((n) => ids.has(n.id)).sort((a, b) => a.label.localeCompare(b.label));
  }, [selected, view]);

  const matches = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (q.length < 2) return [];
    return view.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || b.degree - a.degree)
      .slice(0, 10)
      .map((n) => ({ id: n.id, label: n.label, color: colorOf(n.group), note: labelOf(n.group) }));
  }, [find, view.nodes, colorOf, labelOf]);

  function pick(id: string) {
    setSelected(id);
    setCenterOn((prev) => ({ id, key: (prev?.key ?? 0) + 1 }));
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  const toggleLayer = (id: string) => {
    setSelected(null);
    update({ layers: (layers.includes(id) ? layers.filter((l) => l !== id) : [...layers, id]).join(',') });
  };
  const toggleGroup = (g: string) => {
    const next = new Set(hidden);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    update({ hide: next.size ? Array.from(next).join(',') : null });
  };

  const pages = view.nodes.filter((n) => isPageGroup(n.group)).length;
  const hasPages = (data?.nodes ?? []).some((n) => isPageGroup(n.group));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <NodeSearch
          value={find}
          onChange={setFind}
          options={matches}
          onPick={pick}
          placeholder="Find in the graph…"
          ariaLabel="Find a node in the graph"
          empty="Nothing shown here has that name"
          className="w-64"
        />
        <CheckMenu label="Layers" icon={Layers} options={OPTIONAL_LAYERS} value={layers} onToggle={toggleLayer} />
        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background text-sm cursor-pointer" title="Leave out pages nothing links to and that link to nothing">
          <input type="checkbox" checked={linkedOnly} onChange={(e) => update({ linked: e.target.checked ? '1' : null })} />
          Linked only
        </label>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {pages} page{pages === 1 ? '' : 's'} · {view.edges.length} link{view.edges.length === 1 ? '' : 's'}
          {view.unlinked > 0 && !linkedOnly && (
            <>
              {' · '}
              <button onClick={() => update({ linked: '1' })} className="inline-flex items-center gap-1 hover:text-foreground" title="Pages without any link; click to leave them out">
                <Unlink className="w-3 h-3" /> {view.unlinked} not linked
              </button>
            </>
          )}
        </span>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {groups.map(([g, count]) => (
            <GroupChip key={g} label={labelOf(g)} color={colorOf(g)} count={count} active={!hidden.has(g)} square={!isPageGroup(g)} onClick={() => toggleGroup(g)} />
          ))}
        </div>
      )}

      {view.nodes.length > HEAVY_NODES && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          {view.nodes.length.toLocaleString()} nodes are hard to read as one picture. Switch a layer off, or use Explore to start from one node.
        </p>
      )}

      <div className="relative flex-1 min-h-[420px] flex gap-3">
        <div data-graph-export className="relative flex-1 min-w-0 rounded-lg border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Building graph…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full px-6 text-sm text-destructive">{apiErrorMessage(error, 'Could not load the graph')}</div>
          ) : !hasPages && layers.every((l) => l === 'category' || l === 'tag') ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <p className="text-sm font-medium">No knowledge pages yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Notes, concepts and data sources appear here, connected wherever one mentions another as <code className="px-1 rounded bg-muted">[[Page Title]]</code>.
              </p>
              {hasPermission('pages:create') && (
                <Link to="/pages/new" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                  <Plus className="w-4 h-4" /> Write the first page
                </Link>
              )}
            </div>
          ) : !view.nodes.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted-foreground text-center px-6">
              <p>Everything is switched off.</p>
              <button onClick={() => update({ hide: null, linked: null })} className="text-primary hover:underline">
                Show all kinds again
              </button>
            </div>
          ) : (
            <ForceCanvas
              nodes={view.nodes}
              edges={view.edges}
              selectedId={selected}
              alwaysLabel={view.nodes.length <= 80}
              variant={view.nodes.length <= 60 ? 'card' : 'dot'}
              centerOn={centerOn}
              onNodeClick={(n) => setSelected(String(n.id))}
              onBackgroundClick={() => setSelected(null)}
            />
          )}
        </div>
        {selectedNode && (
          <NodePanel node={selectedNode} onClose={() => setSelected(null)} neighbours={neighbours} onSelectNeighbour={pick}>
            <button onClick={() => onExplore(selectedNode.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs">
              <Compass className="w-3 h-3" /> Explore from here
            </button>
          </NodePanel>
        )}
      </div>
    </>
  );
}
