import { prisma } from './prisma';
import { TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from './attack';
import { REFERENCE_KINDS, computeReferenceMatches } from './references';

// The knowledge graph: pages, wiki links, ATT&CK techniques, Sysmon events,
// tags, categories and attacker-tool references. Built once and cached
// briefly; the routes serve filtered views and neighbourhoods of it.

export interface GraphNode {
  id: string;
  label: string;
  /** Page type (RULE, NOTE, ...) | technique | sysmon | tag | category | lolbas | gtfobins | loldrivers */
  group: string;
  slug?: string;
  url?: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string; // link | technique | sysmon | tag | category | reference
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacency: Map<string, Set<string>>;
}

const NON_PAGE_GROUPS = new Set(['technique', 'sysmon', 'tag', 'category', 'lolbas', 'gtfobins', 'loldrivers']);
export const isPageGroup = (group: string) => !NON_PAGE_GROUPS.has(group);

/** Layer names accepted by GET /api/graph?layers= → node groups they contain. */
export const LAYERS: Record<string, (group: string) => boolean> = {
  pages: (g) => isPageGroup(g) && g !== 'RULE',
  rules: (g) => g === 'RULE',
  technique: (g) => g === 'technique',
  sysmon: (g) => g === 'sysmon',
  tools: (g) => g === 'lolbas' || g === 'gtfobins' || g === 'loldrivers',
  tag: (g) => g === 'tag',
  category: (g) => g === 'category',
};

let cache: { at: number; graph: Graph } | null = null;
const CACHE_MS = 15_000;

async function buildGraph(): Promise<Graph> {
  const [pages, links, sysmon, matches] = await Promise.all([
    prisma.page.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        type: true,
        category: { select: { id: true, name: true } },
        tags: { select: { tag: { select: { name: true } } } },
        rule: { select: { mitreTechniques: true } },
      },
    }),
    prisma.pageLink.findMany({ select: { sourceId: true, targetId: true } }),
    prisma.pageSysmonEvent.findMany({ select: { pageId: true, sysmonEvent: { select: { eventId: true, name: true } } } }),
    computeReferenceMatches(),
  ]);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const node = (n: Omit<GraphNode, 'degree'>) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 });
  };
  const edge = (source: string, target: string, kind: string) => {
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (source === target || seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  for (const p of pages) {
    const id = `page:${p.id}`;
    node({ id, label: p.title, group: p.type, slug: p.slug });
    if (p.category) {
      const cid = `category:${p.category.id}`;
      node({ id: cid, label: p.category.name, group: 'category' });
      edge(id, cid, 'category');
    }
    for (const { tag } of p.tags) {
      const tid = `tag:${tag.name}`;
      node({ id: tid, label: `#${tag.name}`, group: 'tag' });
      edge(id, tid, 'tag');
    }
    for (const raw of parseTechniqueIds(p.rule?.mitreTechniques)) {
      const techId = resolveTechniqueId(raw);
      if (!techId) continue;
      const nid = `technique:${techId}`;
      node({
        id: nid,
        label: `${techId} ${TECHNIQUE_BY_ID.get(techId)?.name ?? ''}`.trim(),
        group: 'technique',
        url: `https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`,
      });
      edge(id, nid, 'technique');
    }
  }
  for (const l of links) edge(`page:${l.sourceId}`, `page:${l.targetId}`, 'link');
  for (const s of sysmon) {
    const nid = `sysmon:${s.sysmonEvent.eventId}`;
    node({ id: nid, label: `EID ${s.sysmonEvent.eventId} ${s.sysmonEvent.name}`, group: 'sysmon' });
    edge(`page:${s.pageId}`, nid, 'sysmon');
  }

  const refKeys = Array.from(matches.byPage.values()).flat();
  if (refKeys.length) {
    const entries = await prisma.referenceEntry.findMany({
      where: { OR: refKeys.map((r) => ({ kind: r.kind, key: r.key })) },
      select: { kind: true, key: true, name: true },
    });
    const names = new Map(entries.map((e) => [`${e.kind}:${e.key}`, e.name]));
    for (const [pageId, refs] of matches.byPage) {
      for (const r of refs) {
        const nid = `${r.kind}:${r.key}`;
        node({ id: nid, label: `${names.get(nid) ?? r.key} (${REFERENCE_KINDS[r.kind].label})`, group: r.kind });
        edge(`page:${pageId}`, nid, 'reference');
      }
    }
  }

  const valid = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  const adjacency = new Map<string, Set<string>>();
  for (const e of valid) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }
  for (const [id, n] of nodes) n.degree = adjacency.get(id)?.size ?? 0;
  return { nodes, edges: valid, adjacency };
}

export async function getGraph(): Promise<Graph> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.graph;
  cache = { at: Date.now(), graph: await buildGraph() };
  return cache.graph;
}

/** Subgraph restricted to the given layers (see LAYERS). */
export function filterLayers(graph: Graph, layers: string[]) {
  const tests = layers.map((l) => LAYERS[l]).filter(Boolean);
  const keep = (g: string) => tests.some((t) => t(g));
  const ids = new Set(Array.from(graph.nodes.values()).filter((n) => keep(n.group)).map((n) => n.id));
  // Without the rules layer, still show rules that knowledge pages [[link]] to
  if (layers.includes('pages') && !layers.includes('rules')) {
    for (const e of graph.edges) {
      if (e.kind !== 'link') continue;
      if (ids.has(e.source) && graph.nodes.get(e.target)?.group === 'RULE') ids.add(e.target);
      if (ids.has(e.target) && graph.nodes.get(e.source)?.group === 'RULE') ids.add(e.source);
    }
  }
  const nodes = Array.from(graph.nodes.values()).filter((n) => ids.has(n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  // Degree within the view, so sizes reflect what is drawn
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), edges };
}

export interface MoreNode {
  id: string; // more:<center>:<group>
  label: string;
  group: 'more';
  center: string;
  targetGroup: string;
  remaining: number;
  offset: number;
  degree: number;
}

/**
 * Neighbours of one node for incremental exploration. Each neighbour group
 * (rules, techniques, …) is capped at `limit`; the rest is summarised by a
 * "more" node that the client can page through with `group` + `offset`.
 */
export function neighbourhood(graph: Graph, centerId: string, opts: { group?: string; offset?: number; limit?: number } = {}) {
  const center = graph.nodes.get(centerId);
  if (!center) return null;
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 200);
  const byGroup = new Map<string, GraphNode[]>();
  for (const id of graph.adjacency.get(centerId) ?? []) {
    const n = graph.nodes.get(id)!;
    if (opts.group && n.group !== opts.group) continue;
    if (!byGroup.has(n.group)) byGroup.set(n.group, []);
    byGroup.get(n.group)!.push(n);
  }

  const nodes: GraphNode[] = [];
  const more: MoreNode[] = [];
  for (const [group, list] of byGroup) {
    // Most connected first: those are the interesting ones to expand next
    list.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    const offset = opts.group ? opts.offset ?? 0 : 0;
    const page = list.slice(offset, offset + limit);
    nodes.push(...page);
    const remaining = list.length - offset - page.length;
    if (remaining > 0) {
      more.push({
        id: `more:${centerId}:${group}`,
        label: `+${remaining} more`,
        group: 'more',
        center: centerId,
        targetGroup: group,
        remaining,
        offset: offset + page.length,
        degree: 1,
      });
    }
  }

  // Edges from the centre, plus edges among the returned neighbours
  const ids = new Set([centerId, ...nodes.map((n) => n.id)]);
  const edges: GraphEdge[] = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  for (const m of more) edges.push({ source: centerId, target: m.id, kind: 'more' });
  return { center, nodes, more, edges };
}
