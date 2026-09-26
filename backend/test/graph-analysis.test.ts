import { describe, expect, it } from 'vitest';
import { CLUSTER_MIN, findPaths, neighbourhood, type Graph, type GraphNode } from '../src/lib/graph';
import { analyzeImpact, computeFlows, otherDataSources, type RuleTelemetry } from '../src/lib/coverage-analysis';

function graphOf(nodes: Partial<GraphNode>[], edges: [string, string][]): Graph {
  const map = new Map<string, GraphNode>();
  for (const n of nodes) map.set(n.id!, { label: n.id!, group: 'NOTE', degree: 0, ...n } as GraphNode);
  const adjacency = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  for (const [id, n] of map) n.degree = adjacency.get(id)?.size ?? 0;
  return { nodes: map, edges: edges.map(([source, target]) => ({ source, target, kind: 'link' })), adjacency };
}

describe('findPaths', () => {
  // tool → rule A → technique, tool → rule B → technique, and a shortcut via a tag
  const g = graphOf(
    [
      { id: 'lolbas:certutil.exe', group: 'lolbas' },
      { id: 'page:1', group: 'RULE' },
      { id: 'page:2', group: 'RULE' },
      { id: 'technique:T1105', group: 'technique' },
      { id: 'tag:windows', group: 'tag' },
      { id: 'page:9', group: 'NOTE' },
    ],
    [
      ['lolbas:certutil.exe', 'page:1'],
      ['lolbas:certutil.exe', 'page:2'],
      ['page:1', 'technique:T1105'],
      ['page:2', 'technique:T1105'],
      ['lolbas:certutil.exe', 'tag:windows'],
      ['tag:windows', 'technique:T1105'],
    ]
  );

  it('returns every shortest path, not through tags', () => {
    const paths = findPaths(g, 'lolbas:certutil.exe', 'technique:T1105');
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p[0]).toBe('lolbas:certutil.exe');
      expect(p.at(-1)).toBe('technique:T1105');
      expect(p).not.toContain('tag:windows');
      expect(p).toHaveLength(3);
    }
  });

  it('can end on a tag, caps paths and hops, and handles no path', () => {
    expect(findPaths(g, 'page:1', 'tag:windows')[0]).toEqual(['page:1', 'lolbas:certutil.exe', 'tag:windows']);
    expect(findPaths(g, 'lolbas:certutil.exe', 'technique:T1105', { maxPaths: 1 })).toHaveLength(1);
    expect(findPaths(g, 'lolbas:certutil.exe', 'technique:T1105', { maxHops: 1 })).toEqual([]);
    expect(findPaths(g, 'page:9', 'page:1')).toEqual([]);
    expect(findPaths(g, 'page:1', 'nope')).toEqual([]);
  });
});

describe('neighbourhood clusters', () => {
  const rules = Array.from({ length: CLUSTER_MIN }, (_, i) => ({
    id: `page:${i}`,
    group: 'RULE',
    status: i < 3 ? 'production' : 'draft',
  }));
  const g = graphOf(
    [{ id: 'technique:T1003', group: 'technique' }, { id: 'sysmon:10', group: 'sysmon' }, ...rules],
    [['technique:T1003', 'sysmon:10'], ...rules.map((r) => ['technique:T1003', r.id] as [string, string])]
  );

  it('sends a large group as one card with a status breakdown', () => {
    const r = neighbourhood(g, 'technique:T1003')!;
    expect(r.nodes.map((n) => n.id)).toEqual(['sysmon:10']);
    expect(r.more).toHaveLength(1);
    expect(r.more[0]).toMatchObject({ cluster: true, remaining: CLUSTER_MIN, offset: 0, breakdown: { production: 3, draft: CLUSTER_MIN - 3 } });
  });

  it('opening the cluster pages through its members', () => {
    const r = neighbourhood(g, 'technique:T1003', { group: 'RULE', offset: 0, limit: 5 })!;
    expect(r.nodes).toHaveLength(5);
    expect(r.more[0]).toMatchObject({ remaining: CLUSTER_MIN - 5, offset: 5 });
    expect(r.more[0].cluster).toBeUndefined();
  });
});

const rule = (pageId: number, sysmon: number[], techniques: string[], extra: Partial<RuleTelemetry> = {}): RuleTelemetry => ({
  pageId,
  title: `Rule ${pageId}`,
  slug: `rule-${pageId}`,
  status: 'production',
  severity: 'high',
  sourceFormat: null,
  dataSource: null,
  techniques,
  sysmon,
  ...extra,
});

describe('otherDataSources', () => {
  it('keeps non-Sysmon sources and drops Sigma logsources', () => {
    expect(otherDataSources('Sysmon EventID 1, Windows Event Log Security 4688')).toEqual(['Windows Event Log Security 4688']);
    expect(otherDataSources('product:windows category:process_access')).toEqual([]);
    expect(otherDataSources('Elastic Defend, Sysmon')).toEqual(['Elastic Defend']);
    expect(otherDataSources(null)).toEqual([]);
  });
});

describe('analyzeImpact', () => {
  const rules = [
    rule(1, [10], ['T1003.001']), // only EID 10 → lost
    rule(2, [10], ['T1003.001'], { dataSource: 'Sysmon EventID 10, Windows Security 4656' }), // → at risk
    rule(3, [1, 10], ['T1003.001', 'T1059']), // → partial
    rule(4, [1], ['T1059']), // unaffected
    rule(5, [10], ['T1055'], { status: 'deprecated' }), // ignored
    rule(6, [10], ['T1134']), // T1134's only rule → technique uncovered
  ];
  const r = analyzeImpact(rules, new Set([10]));

  it('classifies rules', () => {
    expect(Object.fromEntries(r.rules.map((x) => [x.pageId, x.level]))).toEqual({ 1: 'lost', 6: 'lost', 2: 'atRisk', 3: 'partial' });
    expect(r.counts).toEqual({ activeRules: 5, lost: 2, atRisk: 1, partial: 1 });
    expect(r.rules.find((x) => x.pageId === 2)!.alternatives).toEqual(['Windows Security 4656']);
  });

  it('finds techniques left without rules, and reduced ones', () => {
    expect(r.uncovered.map((t) => t.id)).toEqual(['T1134']);
    expect(r.reduced.map((t) => [t.id, t.rules, t.lost, t.atRisk])).toEqual([['T1003.001', 3, 1, 1]]);
  });
});

describe('computeFlows', () => {
  const rules = [
    rule(1, [10], ['T1003.001']), // credential access
    rule(2, [1, 10], ['T1003.001']),
    rule(3, [], ['T1059']), // execution, no Sysmon link
  ];

  it('counts rules per event → tactic', () => {
    const f = computeFlows(rules);
    const link = (s: string, t: string) => f.links.find((l) => l.source === s && l.target === t)?.rules;
    expect(link('sysmon:10', 'tactic:credential-access')).toBe(2);
    expect(link('sysmon:1', 'tactic:credential-access')).toBe(1);
    expect(link('sysmon:none', 'tactic:execution')).toBe(1);
    expect(f.sources.map((s) => s.id)).toEqual(['sysmon:1', 'sysmon:10', 'sysmon:none']);
    expect(f.targets.find((t) => t.id === 'tactic:credential-access')!.rules).toBe(2);
    expect(f.rules).toBe(3);
  });

  it('can leave out rules without a Sysmon link', () => {
    const f = computeFlows(rules, { withoutSysmon: false });
    expect(f.sources.map((s) => s.id)).toEqual(['sysmon:1', 'sysmon:10']);
    expect(f.targets.map((t) => t.id)).toEqual(['tactic:credential-access']);
    expect(f.rules).toBe(2);
  });

  it('drills into a tactic as parent techniques', () => {
    const f = computeFlows(rules, { tactic: 'credential-access' });
    expect(f.targets.map((t) => t.id)).toEqual(['technique:T1003']);
    expect(f.sources.map((s) => s.id)).toEqual(['sysmon:1', 'sysmon:10']);
  });
});
