import { describe, expect, it } from 'vitest';
import { CLUSTER_MIN, findPaths, neighbourhood, type Graph, type GraphNode } from '../src/lib/graph';
import { analyzeImpact, computeFlows, expandLost, otherDataSources, type RuleTelemetry } from '../src/lib/coverage-analysis';

/** Edges default to wiki links; pass the kind as a third element */
function graphOf(nodes: Partial<GraphNode>[], edges: ([string, string] | [string, string, string])[]): Graph {
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
  return { nodes: map, edges: edges.map(([source, target, kind = 'link']) => ({ source, target, kind })), adjacency };
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
      ['page:1', 'lolbas:certutil.exe', 'reference'],
      ['page:2', 'lolbas:certutil.exe', 'reference'],
      ['page:1', 'technique:T1105', 'technique'],
      ['page:2', 'technique:T1105', 'technique'],
      ['lolbas:certutil.exe', 'tag:windows', 'tag'],
      ['technique:T1105', 'tag:windows', 'tag'],
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

  it('skips deprecated rules unless their status is asked for', () => {
    const d = graphOf(
      [
        { id: 'lolbas:certutil.exe', group: 'lolbas' },
        { id: 'page:1', group: 'RULE', status: 'deprecated' },
        { id: 'technique:T1105', group: 'technique' },
      ],
      [
        ['page:1', 'lolbas:certutil.exe', 'reference'],
        ['page:1', 'technique:T1105', 'technique'],
      ]
    );
    expect(findPaths(d, 'lolbas:certutil.exe', 'technique:T1105')).toEqual([]);
    expect(findPaths(d, 'lolbas:certutil.exe', 'technique:T1105', { statuses: ['production', 'deprecated'] })).toHaveLength(1);
    // A deprecated rule may still be an endpoint
    expect(findPaths(d, 'page:1', 'technique:T1105')).toEqual([['page:1', 'technique:T1105']]);
  });

  // rule 1 and rule 2 both use EID 1; a data source provides EID 1
  const s = graphOf(
    [
      { id: 'page:1', group: 'RULE' },
      { id: 'page:2', group: 'RULE' },
      { id: 'page:5', group: 'DATA_SOURCE' },
      { id: 'page:6', group: 'DATA_SOURCE' },
      { id: 'sysmon:1', group: 'sysmon' },
      { id: 'technique:T1059', group: 'technique' },
    ],
    [
      ['page:1', 'sysmon:1', 'sysmon'],
      ['page:2', 'sysmon:1', 'sysmon'],
      ['page:5', 'sysmon:1', 'sysmon'],
      ['page:6', 'sysmon:1', 'sysmon'],
      ['page:2', 'technique:T1059', 'technique'],
    ]
  );

  it('uses a Sysmon event only to join a rule and a data source', () => {
    expect(findPaths(s, 'page:1', 'page:2')).toEqual([]);
    expect(findPaths(s, 'page:1', 'technique:T1059')).toEqual([]);
    expect(findPaths(s, 'page:5', 'page:6')).toEqual([]);
    expect(findPaths(s, 'page:5', 'technique:T1059')).toEqual([['page:5', 'sysmon:1', 'page:2', 'technique:T1059']]);
    // As an endpoint, the event connects to everything that uses it
    expect(findPaths(s, 'sysmon:1', 'technique:T1059')).toEqual([['sysmon:1', 'page:2', 'technique:T1059']]);
  });

  it('follows wiki links only when asked, except from the picked nodes themselves', () => {
    const w = graphOf(
      [
        { id: 'page:1', group: 'RULE' },
        { id: 'page:3', group: 'CONCEPT' },
        { id: 'page:4', group: 'RULE' },
        { id: 'technique:T1003', group: 'technique' },
      ],
      [
        ['page:1', 'page:3'],
        ['page:3', 'page:4'],
        ['page:4', 'technique:T1003', 'technique'],
      ]
    );
    expect(findPaths(w, 'page:1', 'technique:T1003')).toEqual([]);
    expect(findPaths(w, 'page:1', 'technique:T1003', { links: true })).toEqual([['page:1', 'page:3', 'page:4', 'technique:T1003']]);
    // The concept's own link counts: it's the page the user picked
    expect(findPaths(w, 'page:3', 'technique:T1003')).toEqual([['page:3', 'page:4', 'technique:T1003']]);
  });

  it('steps from a sub-technique to its parent', () => {
    const t = graphOf(
      [
        { id: 'lolbas:rundll32.exe', group: 'lolbas' },
        { id: 'technique:T1003', group: 'technique' },
        { id: 'technique:T1003.001', group: 'technique' },
      ],
      [
        ['lolbas:rundll32.exe', 'technique:T1003', 'tool-technique'],
        ['technique:T1003.001', 'technique:T1003', 'subtechnique'],
      ]
    );
    expect(findPaths(t, 'technique:T1003.001', 'lolbas:rundll32.exe')).toEqual([['technique:T1003.001', 'technique:T1003', 'lolbas:rundll32.exe']]);
  });

  it('prefers paths that differ from each other', () => {
    // tool → rule r (1..3) → technique a|b → tool 2: 6 shortest paths, 3 disjoint in rules
    const nodes: Partial<GraphNode>[] = [
      { id: 'lolbas:a', group: 'lolbas' },
      { id: 'lolbas:b', group: 'lolbas' },
      { id: 'technique:T1', group: 'technique' },
      { id: 'technique:T2', group: 'technique' },
    ];
    const edges: [string, string, string][] = [
      ['lolbas:b', 'technique:T1', 'tool-technique'],
      ['lolbas:b', 'technique:T2', 'tool-technique'],
    ];
    for (const r of [1, 2, 3]) {
      nodes.push({ id: `page:${r}`, group: 'RULE' });
      edges.push([`page:${r}`, 'lolbas:a', 'reference'], [`page:${r}`, 'technique:T1', 'technique'], [`page:${r}`, 'technique:T2', 'technique']);
    }
    const paths = findPaths(graphOf(nodes, edges), 'lolbas:a', 'lolbas:b', { maxPaths: 3 });
    expect(paths).toHaveLength(3);
    expect(new Set(paths.map((p) => p[1])).size).toBe(3);
  });

  it('treats log events like Sysmon events, and uses groups only as endpoints', () => {
    const g = graphOf(
      [
        { id: 'page:1', group: 'RULE' },
        { id: 'page:2', group: 'RULE' },
        { id: 'page:5', group: 'DATA_SOURCE' },
        { id: 'log:windows-security:4688', group: 'logevent' },
        { id: 'technique:T1059', group: 'technique' },
        { id: 'technique:T1105', group: 'technique' },
        { id: 'group:G0049', group: 'threat-group' },
      ],
      [
        ['page:1', 'log:windows-security:4688', 'telemetry'],
        ['page:2', 'log:windows-security:4688', 'telemetry'],
        ['page:5', 'log:windows-security:4688', 'telemetry'],
        ['page:2', 'technique:T1059', 'technique'],
        ['group:G0049', 'technique:T1059', 'group-technique'],
        ['group:G0049', 'technique:T1105', 'group-technique'],
      ]
    );
    expect(findPaths(g, 'page:1', 'technique:T1059')).toEqual([]);
    expect(findPaths(g, 'page:5', 'technique:T1059')).toEqual([['page:5', 'log:windows-security:4688', 'page:2', 'technique:T1059']]);
    expect(findPaths(g, 'group:G0049', 'page:2')).toEqual([['group:G0049', 'technique:T1059', 'page:2']]);
    // A group is not a bridge between two techniques
    expect(findPaths(g, 'technique:T1105', 'page:2')).toEqual([]);
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

/** A rule reading these Sysmon events and log event keys */
const rule = (pageId: number, sysmon: number[], techniques: string[], extra: Partial<RuleTelemetry> & { logs?: string[] } = {}): RuleTelemetry => {
  const { logs = [], ...rest } = extra;
  return {
    pageId,
    title: `Rule ${pageId}`,
    slug: `rule-${pageId}`,
    status: 'production',
    severity: 'high',
    sourceFormat: null,
    dataSource: null,
    techniques,
    sysmon,
    telemetry: [...sysmon.map((e) => `sysmon:${e}`), ...logs],
    ...rest,
  };
};

describe('otherDataSources', () => {
  it('keeps only names DetectKB could not map', () => {
    expect(otherDataSources('Sysmon EventID 1, Windows Event Log Security 4688')).toEqual([]);
    expect(otherDataSources('product:windows category:process_access')).toEqual([]);
    expect(otherDataSources('Elastic Defend, Sysmon, Winlogbeat')).toEqual(['Winlogbeat']);
    expect(otherDataSources('Some vendor feed')).toEqual(['Some vendor feed']);
    // ESCU names are all linked (unknown ones under "Other")
    expect(otherDataSources('Some vendor feed', 'escu')).toEqual([]);
    expect(otherDataSources(null)).toEqual([]);
  });
});

describe('expandLost', () => {
  it('takes every key of a lost source plus the listed events', () => {
    const all = ['sysmon:1', 'sysmon:10', 'windows-security:4688', 'windows-security:*', 'crowdstrike:processrollup2'];
    expect(Array.from(expandLost(all, ['windows-security'], ['sysmon:10'])).sort()).toEqual([
      'sysmon:10',
      'windows-security:*',
      'windows-security:4688',
    ]);
  });
});

describe('analyzeImpact', () => {
  const rules = [
    rule(1, [10], ['T1003.001']), // only EID 10 → lost
    rule(2, [10], ['T1003.001'], { dataSource: 'Sysmon EventID 10, Some vendor feed' }), // unmapped source → at risk
    rule(3, [1, 10], ['T1003.001', 'T1059']), // → partial
    rule(4, [1], ['T1059']), // unaffected
    rule(5, [10], ['T1055'], { status: 'deprecated' }), // ignored
    rule(6, [10], ['T1134']), // T1134's only rule → technique uncovered
    rule(7, [10], ['T1134'], { logs: ['windows-security:4656'] }), // Security 4656 still feeds it → partial
  ];
  const r = analyzeImpact(rules, new Set(['sysmon:10']));

  it('classifies rules', () => {
    expect(Object.fromEntries(r.rules.map((x) => [x.pageId, x.level]))).toEqual({ 1: 'lost', 6: 'lost', 2: 'atRisk', 3: 'partial', 7: 'partial' });
    expect(r.counts).toEqual({ activeRules: 6, lost: 2, atRisk: 1, partial: 2 });
    expect(r.rules.find((x) => x.pageId === 2)!.alternatives).toEqual(['Some vendor feed']);
    expect(r.rules.find((x) => x.pageId === 7)!.lostEvents).toEqual(['sysmon:10']);
  });

  it('finds techniques left without rules, and reduced ones', () => {
    expect(r.uncovered.map((t) => t.id)).toEqual([]);
    expect(r.reduced.map((t) => [t.id, t.rules, t.lost, t.atRisk])).toEqual([
      ['T1003.001', 3, 1, 1],
      ['T1134', 2, 1, 0],
    ]);
  });

  it('counts a technique uncovered when every rule is lost', () => {
    const both = analyzeImpact(rules, new Set(['sysmon:10', 'windows-security:4656']));
    expect(both.uncovered.map((t) => t.id)).toEqual(['T1134']);
  });
});

describe('computeFlows', () => {
  const rules = [
    rule(1, [10], ['T1003.001']), // credential access
    rule(2, [1, 10], ['T1003.001'], { logs: ['windows-security:4688'] }),
    rule(3, [], ['T1059']), // execution, no telemetry link
    rule(4, [], ['T1059'], { logs: ['windows-security:4688'] }),
  ];
  const link = (f: ReturnType<typeof computeFlows>, s: string, t: string) => f.links.find((l) => l.source === s && l.target === t)?.rules;

  it('counts rules per log source → tactic, each rule once per source', () => {
    const f = computeFlows(rules);
    expect(link(f, 'src:sysmon', 'tactic:credential-access')).toBe(2);
    expect(link(f, 'src:windows-security', 'tactic:credential-access')).toBe(1);
    expect(link(f, 'src:windows-security', 'tactic:execution')).toBe(1);
    expect(link(f, 'none', 'tactic:execution')).toBe(1);
    expect(f.sources.map((s) => [s.id, s.kind, s.key, s.rules])).toEqual([
      ['src:sysmon', 'source', 'sysmon', 2],
      ['src:windows-security', 'source', 'windows-security', 2],
      ['none', 'none', null, 1],
    ]);
    expect(f.targets.find((t) => t.id === 'tactic:credential-access')!.rules).toBe(2);
    expect(f.rules).toBe(4);
  });

  it('shows single events, merging small ones per source', () => {
    const f = computeFlows(rules, { groupBy: 'event', minRules: 2 });
    expect(f.sources.map((s) => s.id)).toEqual(['ev:sysmon:10', 'ev:windows-security:4688', 'other:sysmon', 'none']);
    expect(link(f, 'other:sysmon', 'tactic:credential-access')).toBe(1);
  });

  it('can leave out rules without telemetry', () => {
    const f = computeFlows(rules, { withoutTelemetry: false });
    expect(f.sources.map((s) => s.id)).toEqual(['src:sysmon', 'src:windows-security']);
    expect(f.rules).toBe(3);
  });

  it('drills into a tactic as parent techniques', () => {
    const f = computeFlows(rules, { tactic: 'credential-access' });
    expect(f.targets.map((t) => t.id)).toEqual(['technique:T1003']);
    expect(f.sources.map((s) => s.id)).toEqual(['src:sysmon', 'src:windows-security']);
  });
});
