import { prisma } from './prisma';
import { TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from './attack';
import { REFERENCE_KINDS, computeReferenceMatches } from './references';
import { kbCache, onDataChanged } from './kb-cache';

// The knowledge graph: pages, wiki links, ATT&CK techniques, Sysmon events,
// tags, categories and attacker-tool references. Built once and cached until
// data changes (lib/kb-cache); the routes serve filtered views and
// neighbourhoods of it.

export interface GraphNode {
  id: string;
  label: string;
  /** Page type (RULE, NOTE, ...) | technique | sysmon | tag | category | lolbas | gtfobins | loldrivers */
  group: string;
  slug?: string;
  url?: string;
  /** Rule nodes: status and severity, shown on node cards */
  status?: string;
  severity?: string;
  /** Technique and tool nodes: rules mapped to / mentioning it */
  ruleCount?: number;
  /** Technique or tool no rule covers — a detection gap */
  gap?: boolean;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string; // link | technique | sysmon | tag | category | reference | tool-technique
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
        rule: { select: { mitreTechniques: true, status: true, severity: true } },
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

  const techniqueNode = (techId: string) => {
    const nid = `technique:${techId}`;
    node({
      id: nid,
      label: `${techId} ${TECHNIQUE_BY_ID.get(techId)?.name ?? ''}`.trim(),
      group: 'technique',
      url: `https://attack.mitre.org/techniques/${techId.replace('.', '/')}/`,
    });
    return nid;
  };

  for (const p of pages) {
    const id = `page:${p.id}`;
    node({ id, label: p.title, group: p.type, slug: p.slug, status: p.rule?.status, severity: p.rule?.severity });
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
      edge(id, techniqueNode(techId), 'technique');
    }
  }
  for (const l of links) edge(`page:${l.sourceId}`, `page:${l.targetId}`, 'link');
  for (const s of sysmon) {
    const nid = `sysmon:${s.sysmonEvent.eventId}`;
    node({ id: nid, label: `EID ${s.sysmonEvent.eventId} ${s.sysmonEvent.name}`, group: 'sysmon' });
    edge(`page:${s.pageId}`, nid, 'sysmon');
  }

  // Attacker tools: those rules mention, and every other one that maps to an
  // ATT&CK technique (with no rule, it's a detection gap)
  const toolNode = (nid: string) => {
    const kind = nid.slice(0, nid.indexOf(':')) as keyof typeof REFERENCE_KINDS;
    const key = nid.slice(nid.indexOf(':') + 1);
    node({ id: nid, label: `${matches.names.get(nid) ?? key} (${REFERENCE_KINDS[kind].label})`, group: kind });
  };
  for (const [pageId, refs] of matches.byPage) {
    for (const r of refs) {
      const nid = `${r.kind}:${r.key}`;
      toolNode(nid);
      edge(`page:${pageId}`, nid, 'reference');
    }
  }
  for (const [nid, techIds] of matches.techniques) {
    toolNode(nid);
    for (const techId of techIds) {
      techniqueNode(techId);
      edge(nid, `technique:${techId}`, 'tool-technique');
    }
  }

  // Rule counts: techniques (rules mapped to that ID) and tools (rules mentioning it)
  for (const e of edges) {
    if (e.kind === 'technique') nodes.get(e.target)!.ruleCount = (nodes.get(e.target)!.ruleCount ?? 0) + 1;
  }
  for (const [nid, n] of nodes) {
    if (n.group === 'technique') n.gap = !n.ruleCount;
    else if (n.group in REFERENCE_KINDS) {
      n.ruleCount = matches.byEntry.get(nid)?.length ?? 0;
      n.gap = !n.ruleCount;
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

const graphCache = kbCache(buildGraph);
let lastUsed = 0;

export function getGraph(): Promise<Graph> {
  lastUsed = Date.now();
  return graphCache.get();
}

// After a change, rebuild in the background once writes settle (an import
// makes hundreds), so the next graph view doesn't wait for it. Only while
// someone has used the graph recently.
const WARM_DELAY_MS = 3_000;
const WARM_IF_USED_WITHIN_MS = 30 * 60_000;
let warmTimer: NodeJS.Timeout | null = null;
onDataChanged(() => {
  if (Date.now() - lastUsed > WARM_IF_USED_WITHIN_MS) return;
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    graphCache.get().catch((err) => console.error('Graph rebuild failed:', err));
  }, WARM_DELAY_MS);
  warmTimer.unref();
});

/** Subgraph restricted to the given layers (see LAYERS). */
export function filterLayers(graph: Graph, layers: string[]) {
  const tests = layers.map((l) => LAYERS[l]).filter(Boolean);
  const keep = (g: string) => tests.some((t) => t(g));
  // Layer views show the knowledge base itself: uncovered tools and techniques
  // (gaps) are for Explore, paths and the gaps view
  const ids = new Set(Array.from(graph.nodes.values()).filter((n) => keep(n.group) && !n.gap).map((n) => n.id));
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
  /**
   * A whole neighbour group shown as one card ("96 rules") instead of its
   * members; `breakdown` counts them by status (rules) or gap/covered.
   */
  cluster?: boolean;
  breakdown?: Record<string, number>;
  degree: number;
}

/** Neighbour groups larger than this arrive as one cluster card. */
export const CLUSTER_MIN = 13;

function breakdownOf(list: GraphNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of list) {
    const key = n.group === 'RULE' ? n.status ?? 'unknown' : n.gap ? 'gap' : 'covered';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Neighbours of one node for incremental exploration. Small neighbour groups
 * come back whole; a group of CLUSTER_MIN or more comes back as one cluster
 * card. Opening a cluster (or "+N more") pages through a group with `group`
 * + `offset`, `limit` at a time.
 */
export function neighbourhood(graph: Graph, centerId: string, opts: { group?: string; offset?: number; limit?: number } = {}) {
  const center = graph.nodes.get(centerId);
  if (!center) return null;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
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
    if (!opts.group && list.length >= CLUSTER_MIN) {
      more.push({
        id: `more:${centerId}:${group}`,
        label: `${list.length}`,
        group: 'more',
        center: centerId,
        targetGroup: group,
        remaining: list.length,
        offset: 0,
        cluster: true,
        breakdown: breakdownOf(list),
        degree: 1,
      });
      continue;
    }
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

/** Tags and categories connect almost anything in two hops; paths avoid them. */
const PATH_SKIP_GROUPS = new Set(['tag', 'category']);

/**
 * Shortest paths between two nodes (each a list of node IDs, from → to), at
 * most `maxPaths`, none longer than `maxHops` edges. Tag and category nodes
 * are not used as stepping stones. Empty when the nodes aren't connected.
 */
export function findPaths(graph: Graph, from: string, to: string, opts: { maxPaths?: number; maxHops?: number } = {}): string[][] {
  const maxPaths = opts.maxPaths ?? 8;
  const maxHops = opts.maxHops ?? 6;
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return [];
  if (from === to) return [[from]];
  const passable = (id: string) => id === to || !PATH_SKIP_GROUPS.has(graph.nodes.get(id)!.group);

  // Breadth-first from `from`, recording every predecessor on a shortest path
  const dist = new Map<string, number>([[from, 0]]);
  const preds = new Map<string, string[]>();
  let frontier = [from];
  for (let d = 1; d <= maxHops && frontier.length && !dist.has(to); d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of graph.adjacency.get(id) ?? []) {
        if (!passable(nb)) continue;
        const seen = dist.get(nb);
        if (seen === undefined) {
          dist.set(nb, d);
          preds.set(nb, [id]);
          next.push(nb);
        } else if (seen === d) {
          preds.get(nb)!.push(id);
        }
      }
    }
    frontier = next;
  }
  if (!dist.has(to)) return [];

  // Walk predecessors back from `to`; hub-light paths first (fewer, more specific links)
  const degree = (id: string) => graph.nodes.get(id)!.degree;
  const paths: string[][] = [];
  const walk = (id: string, suffix: string[]) => {
    if (paths.length >= maxPaths) return;
    if (id === from) {
      paths.push([from, ...suffix]);
      return;
    }
    for (const p of [...(preds.get(id) ?? [])].sort((a, b) => degree(a) - degree(b))) walk(p, [id, ...suffix]);
  };
  walk(to, []);
  return paths;
}
