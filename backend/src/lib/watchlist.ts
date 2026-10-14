import { parentTechniqueId } from './attack';
import { AttackGroup, actorCoverage } from './attack-cti';
import { RuleTelemetry } from './coverage-analysis';

// Priorities from the watchlist: the techniques the watched groups use, how
// well deployed rules (production and testing) cover each, and which draft
// rules would close the gaps — so work goes where the relevant threats are.

const DEPLOYED = new Set(['production', 'testing']);
// Tactics that happen outside the organisation's systems: rarely detectable with its telemetry
const PRE_COMPROMISE = new Set(['reconnaissance', 'resource-development']);
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export interface WatchTechnique {
  id: string;
  name: string;
  tactics: string[];
  /** Watched groups using it */
  groups: string[];
  /** covered: a deployed rule on it; parent: only on its parent; none: a gap */
  state: 'covered' | 'parent' | 'none';
  deployedRules: number;
  draftRules: number;
  /** Only in Reconnaissance / Resource Development: happens before the attacker touches your systems */
  preCompromise: boolean;
}

export interface WatchDraft {
  pageId: number;
  title: string;
  slug: string;
  severity: string;
  /** Gap (or parent-only) techniques of watched groups it would cover */
  fills: string[];
  /** Watched groups whose gaps it would close */
  groups: string[];
  /** Other watched-group techniques it covers (already covered: adds depth) */
  depth: string[];
}

/** Would a rule on `rule` count for technique `used`? (Same rules as actorCoverage: a parent is covered by its sub-techniques' rules.) */
export function fillsTechnique(used: string, rule: string): boolean {
  return rule === used || (!used.includes('.') && parentTechniqueId(rule) === used);
}

export function prioritize(watched: Pick<AttackGroup, 'id' | 'techniques'>[], rules: Pick<RuleTelemetry, 'pageId' | 'title' | 'slug' | 'status' | 'severity' | 'techniques'>[]) {
  const groupsOf = new Map<string, string[]>();
  for (const g of watched) for (const t of new Set(g.techniques)) groupsOf.set(t, [...(groupsOf.get(t) ?? []), g.id]);

  const byTech = (filter: (status: string) => boolean) => {
    const out = new Map<string, Set<number>>();
    for (const r of rules) {
      if (!filter(r.status)) continue;
      for (const t of r.techniques) {
        if (!out.has(t)) out.set(t, new Set());
        out.get(t)!.add(r.pageId);
      }
    }
    return out;
  };
  const deployed = byTech((s) => DEPLOYED.has(s));
  const drafts = byTech((s) => s === 'draft');
  const coverage = actorCoverage(Array.from(groupsOf.keys()), deployed);

  const count = (map: Map<string, Set<number>>, id: string) => {
    const ids = new Set<number>();
    for (const [t, pages] of map) if (fillsTechnique(id, t)) for (const p of pages) ids.add(p);
    return ids.size;
  };
  const stateOrder = { none: 0, parent: 1, covered: 2 };
  const techniques: WatchTechnique[] = coverage.techniques
    .map((t) => ({
      id: t.id,
      name: t.name,
      tactics: t.tactics,
      groups: groupsOf.get(t.id) ?? [],
      state: t.state,
      deployedRules: count(deployed, t.id),
      draftRules: count(drafts, t.id),
      preCompromise: t.tactics.length > 0 && t.tactics.every((x) => PRE_COMPROMISE.has(x)),
    }))
    .sort(
      (a, b) =>
        stateOrder[a.state] - stateOrder[b.state] ||
        Number(a.preCompromise) - Number(b.preCompromise) ||
        b.groups.length - a.groups.length ||
        a.id.localeCompare(b.id)
    );

  const open = techniques.filter((t) => t.state !== 'covered');
  const done = techniques.filter((t) => t.state === 'covered');
  const draftList: WatchDraft[] = [];
  for (const r of rules) {
    if (r.status !== 'draft') continue;
    const fills = open.filter((t) => r.techniques.some((rt) => fillsTechnique(t.id, rt))).map((t) => t.id);
    const depth = done.filter((t) => r.techniques.some((rt) => fillsTechnique(t.id, rt))).map((t) => t.id);
    if (!fills.length && !depth.length) continue;
    const groups = new Set(fills.flatMap((t) => groupsOf.get(t) ?? []));
    draftList.push({ pageId: r.pageId, title: r.title, slug: r.slug, severity: r.severity, fills, groups: Array.from(groups), depth });
  }
  draftList.sort(
    (a, b) =>
      b.groups.length - a.groups.length ||
      b.fills.length - a.fills.length ||
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
      b.depth.length - a.depth.length ||
      a.title.localeCompare(b.title)
  );

  return {
    techniques,
    drafts: draftList,
    summary: {
      techniques: techniques.length,
      covered: done.length,
      parentOnly: open.filter((t) => t.state === 'parent').length,
      gaps: open.filter((t) => t.state === 'none').length,
      /** Gaps and parent-only techniques that are pre-compromise */
      preCompromise: open.filter((t) => t.preCompromise).length,
      /** Gaps and parent-only techniques (not pre-compromise) no draft would cover either: need new rules or telemetry */
      openWithoutDraft: open.filter((t) => !t.draftRules && !t.preCompromise).length,
      draftsFillingGaps: draftList.filter((d) => d.fills.length).length,
    },
  };
}
