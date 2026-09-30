import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Compass, Loader2 } from 'lucide-react';
import { getGraph, type GraphLayer } from '@/lib/api';
import { usePageTypes } from '@/context/PageTypesContext';
import { cn } from '@/lib/utils';
import { ForceCanvas } from './ForceCanvas';
import { NodePanel } from './NodePanel';
import { ENTITY_GROUPS, isPageGroup } from './graphStyle';

const OPTIONAL_LAYERS: { layer: GraphLayer; label: string; color: string }[] = [
  { layer: 'category', label: 'Categories', color: ENTITY_GROUPS.category.color },
  { layer: 'tag', label: 'Tags', color: ENTITY_GROUPS.tag.color },
  { layer: 'rules', label: 'All rules', color: '#4338ca' },
  { layer: 'technique', label: 'ATT&CK techniques', color: ENTITY_GROUPS.technique.color },
  { layer: 'sysmon', label: 'Sysmon events', color: ENTITY_GROUPS.sysmon.color },
  { layer: 'logs', label: 'Log events', color: ENTITY_GROUPS.logevent.color },
  { layer: 'tools', label: 'Attacker tools', color: ENTITY_GROUPS.lolbas.color },
  { layer: 'stories', label: 'Analytic stories', color: ENTITY_GROUPS.story.color },
  { layer: 'groups', label: 'Threat groups', color: ENTITY_GROUPS['threat-group'].color },
  { layer: 'software', label: 'Malware & tools', color: ENTITY_GROUPS.software.color },
  { layer: 'mitigations', label: 'Mitigations', color: ENTITY_GROUPS.mitigation.color },
];
const HEAVY_NODES = 400;

/**
 * Obsidian-style view: knowledge pages (notes, concepts, data sources, …) and
 * their [[links]]. Detection layers can be added, but are off by default.
 */
export function WikiView({ onExplore }: { onExplore: (nodeId: string) => void }) {
  const { getLabelFor, getColorFor } = usePageTypes();
  const [layers, setLayers] = useState<GraphLayer[]>(['pages', 'category']);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['graph', layers], queryFn: () => getGraph(layers) });

  const view = useMemo(() => {
    const nodes = (data?.nodes ?? []).filter((n) => !hiddenTypes.has(n.group));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: (data?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [data, hiddenTypes]);

  const pageTypes = useMemo(
    () => Array.from(new Set((data?.nodes ?? []).map((n) => n.group).filter(isPageGroup))).sort(),
    [data]
  );
  const selectedNode = view.nodes.find((n) => n.id === selected) ?? null;
  const neighbours = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(view.edges.flatMap((e) => (e.source === selected ? [e.target] : e.target === selected ? [e.source] : [])));
    return view.nodes.filter((n) => ids.has(n.id)).sort((a, b) => a.label.localeCompare(b.label));
  }, [selected, view]);

  function toggleType(group: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function toggleLayer(layer: GraphLayer) {
    setSelected(null);
    setLayers((prev) => (prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]));
  }

  const chip = (active: boolean) =>
    cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-opacity', active ? 'border-border bg-card' : 'opacity-45 border-border');

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {pageTypes.map((g) => (
          <button
            key={g}
            onClick={() => toggleType(g)}
            aria-pressed={!hiddenTypes.has(g)}
            className={chip(!hiddenTypes.has(g))}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColorFor(g) }} />
            {getLabelFor(g)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">Add layer:</span>
        {OPTIONAL_LAYERS.map(({ layer, label, color }) => (
          <button key={layer} onClick={() => toggleLayer(layer)} aria-pressed={layers.includes(layer)} className={chip(layers.includes(layer))}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </button>
        ))}
      </div>
      {view.nodes.length > HEAVY_NODES && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          {view.nodes.length} nodes — this is hard to read as one picture. Use Explore to start from a single node, or
          Detection chain for a technique.
        </p>
      )}

      <div data-graph-export className="relative flex-1 min-h-[420px] rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Building graph…
          </div>
        ) : !view.nodes.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted-foreground text-center px-6">
            <p>No knowledge pages to show yet. Write notes, concepts and data sources and link them with [[Page Title]].</p>
          </div>
        ) : (
          <ForceCanvas
            nodes={view.nodes}
            edges={view.edges}
            selectedId={selected}
            alwaysLabel={view.nodes.length <= 80}
            variant={view.nodes.length <= 60 ? 'card' : 'dot'}
            onNodeClick={(n) => setSelected(String(n.id))}
            onBackgroundClick={() => setSelected(null)}
          />
        )}
        {selectedNode && (
          <NodePanel node={selectedNode} onClose={() => setSelected(null)} neighbours={neighbours} onSelectNeighbour={setSelected}>
            <button
              onClick={() => onExplore(selectedNode.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs"
            >
              <Compass className="w-3 h-3" /> Explore from here
            </button>
          </NodePanel>
        )}
      </div>
    </>
  );
}
