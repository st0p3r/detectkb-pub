import { prisma } from './prisma';
import { kbCache } from './kb-cache';
import { TECHNIQUE_BY_ID, parentTechniqueId } from './attack';
import { RuleTelemetry, alternatives, loadRuleTelemetry, otherDataSources, telemetrySource } from './coverage-analysis';

// Which telemetry the organisation collects, and what that means for each
// rule. A rule in production whose logs never arrive detects nothing, so
// coverage, gaps and impact analysis can leave such rules out.
//
// Keys: a whole log source ("sysmon", "windows-security") or one event
// ("sysmon:10", "windows-security:4688"). An event's own answer overrides its
// source's; no answer at all is "unknown".

export type CollectionState = 'collected' | 'not-collected' | 'unknown';

/** key → collected? (only the keys someone decided on) */
export type CollectionMap = ReadonlyMap<string, boolean>;

/**
 * fed: some way to feed the rule is fully collected.
 * blind: every way needs something that isn't collected — the rule can't fire.
 * unknown: not decided yet, no telemetry link, or it names data sources DetectKB can't map.
 */
export type RuleFeed = 'fed' | 'blind' | 'unknown';

export function keyState(map: CollectionMap, key: string): CollectionState {
  const own = map.get(key);
  const answer = own ?? (key.includes(':') ? map.get(telemetrySource(key)) : undefined);
  return answer === undefined ? 'unknown' : answer ? 'collected' : 'not-collected';
}

type FeedRule = Pick<RuleTelemetry, 'telemetry' | 'groups' | 'dataSource' | 'sourceFormat'>;

export function ruleFeed(rule: FeedRule, map: CollectionMap): RuleFeed {
  if (!collectionActive(map)) return 'unknown';
  const alts = alternatives(rule);
  if (!alts.length) return 'unknown';
  if (alts.some((a) => a.every((k) => keyState(map, k) === 'collected'))) return 'fed';
  const allBroken = alts.every((a) => a.some((k) => keyState(map, k) === 'not-collected'));
  // A data source DetectKB couldn't map may still feed it
  return allBroken && !otherDataSources(rule.dataSource, rule.sourceFormat).length ? 'blind' : 'unknown';
}

/** The rule's telemetry keys that are marked as not collected. */
export function missingKeys(rule: Pick<RuleTelemetry, 'telemetry'>, map: CollectionMap): string[] {
  return rule.telemetry.filter((k) => keyState(map, k) === 'not-collected');
}

/** Whether anyone said which logs are collected (field answers share the table but say nothing about that). */
export const collectionActive = (map: CollectionMap) => Array.from(map.keys()).some((k) => !isFieldKey(k));

const collectionCache = kbCache(async (): Promise<Map<string, boolean>> => {
  const rows = await prisma.telemetryCollection.findMany({ select: { key: true, collected: true } });
  return new Map(rows.map((r) => [r.key, r.collected]));
});

export function loadCollection(): Promise<CollectionMap> {
  return collectionCache.get();
}

/** pageId → feed, for every rule (all "unknown" while nothing is marked). */
export async function loadRuleFeeds(): Promise<{ active: boolean; feed: (pageId: number) => RuleFeed; map: CollectionMap }> {
  const [map, rules] = await Promise.all([loadCollection(), loadRuleTelemetry()]);
  if (!collectionActive(map)) return { active: false, feed: () => 'unknown', map };
  const byPage = new Map(rules.map((r) => [r.pageId, ruleFeed(r, map)]));
  return { active: true, feed: (pageId) => byPage.get(pageId) ?? 'unknown', map };
}

const DEPLOYED = new Set(['production', 'testing']);
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export interface ReadyRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  /** (Parent) techniques it would newly cover: no deployed rule with logs covers them today */
  fills: string[];
}

export interface SourceOpportunity {
  /** Log source key */
  source: string;
  state: CollectionState;
  /** Rules that read it and can't fire today (blind) or whose logs are undecided (unknown) */
  rules: number;
  /** …of those, the ones that are deployed (production / testing) */
  deployedRules: number;
  /** Parent techniques with no fed deployed rule that these rules map to */
  techniques: string[];
}

/**
 * What the collection answers make possible:
 *  - ready: draft rules whose logs are already collected, first the ones
 *    covering a technique nothing deployed covers ("enable these today")
 *  - sources: log sources not (known to be) collected, by how many rules and
 *    uncovered techniques collecting them would feed
 */
export function opportunities(rules: RuleTelemetry[], map: CollectionMap) {
  const active = rules.filter((r) => r.status !== 'deprecated');
  const feeds = new Map(active.map((r) => [r.pageId, ruleFeed(r, map)]));
  const parents = (r: RuleTelemetry) => Array.from(new Set(r.techniques.map(parentTechniqueId)));

  // Parent techniques a deployed rule covers and that rule isn't blind
  const covered = new Set<string>();
  for (const r of active) if (DEPLOYED.has(r.status) && feeds.get(r.pageId) !== 'blind') for (const t of parents(r)) covered.add(t);

  const ready: ReadyRule[] = active
    .filter((r) => r.status === 'draft' && feeds.get(r.pageId) === 'fed')
    .map((r) => ({ pageId: r.pageId, title: r.title, slug: r.slug, status: r.status, severity: r.severity, fills: parents(r).filter((t) => !covered.has(t)) }))
    .sort(
      (a, b) =>
        Number(!!b.fills.length) - Number(!!a.fills.length) ||
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
        b.fills.length - a.fills.length ||
        a.title.localeCompare(b.title)
    );

  const bySource = new Map<string, { rules: Set<number>; deployed: Set<number>; techniques: Set<string> }>();
  for (const r of active) {
    if (feeds.get(r.pageId) === 'fed') continue;
    for (const key of r.telemetry) {
      if (keyState(map, key) === 'collected') continue;
      const source = telemetrySource(key);
      if (!bySource.has(source)) bySource.set(source, { rules: new Set(), deployed: new Set(), techniques: new Set() });
      const s = bySource.get(source)!;
      s.rules.add(r.pageId);
      if (DEPLOYED.has(r.status)) s.deployed.add(r.pageId);
      for (const t of parents(r)) if (!covered.has(t)) s.techniques.add(t);
    }
  }
  const sources: SourceOpportunity[] = Array.from(bySource, ([source, s]) => ({
    source,
    state: keyState(map, source),
    rules: s.rules.size,
    deployedRules: s.deployed.size,
    techniques: Array.from(s.techniques).sort(),
  })).sort((a, b) => b.techniques.length - a.techniques.length || b.rules - a.rules || a.source.localeCompare(b.source));

  return { ready, sources };
}

/** Counts for the summary: non-deprecated rules by feed, and how many deployed ones are blind. */
export function feedSummary(rules: RuleTelemetry[], map: CollectionMap) {
  const out = { fed: 0, blind: 0, unknown: 0, blindDeployed: 0, blindProduction: 0 };
  for (const r of rules) {
    if (r.status === 'deprecated') continue;
    const f = ruleFeed(r, map);
    out[f]++;
    if (f === 'blind' && DEPLOYED.has(r.status)) out.blindDeployed++;
    if (f === 'blind' && r.status === 'production') out.blindProduction++;
  }
  return out;
}

export const techniqueName = (id: string) => TECHNIQUE_BY_ID.get(id)?.name ?? id;

// ── Fields ──────────────────────────────────────────────────────────────────
// A field can be marked as missing from the organisation's events (key
// "field:<name>", lower-cased). Which of a rule's fields are essential can't be
// told from its text, so a missing field is a warning on the rule — it doesn't
// take the rule out of coverage the way missing logs do.

export const isFieldKey = (key: string) => key.startsWith('field:');

export function fieldState(map: CollectionMap, field: string): CollectionState {
  const answer = map.get(`field:${field.toLowerCase()}`);
  return answer === undefined ? 'unknown' : answer ? 'collected' : 'not-collected';
}

/** pageId → the fields that rule reads which are marked as missing. */
export async function loadMissingFields(): Promise<Map<number, string[]>> {
  const map = await loadCollection();
  const missing = Array.from(map).filter(([key, ok]) => isFieldKey(key) && !ok).map(([key]) => key.slice('field:'.length));
  const out = new Map<number, string[]>();
  if (!missing.length) return out;
  // MySQL's default collation compares field names case-insensitively
  const rows = await prisma.ruleField.findMany({ where: { field: { in: missing } }, select: { pageId: true, field: true } });
  for (const r of rows) out.set(r.pageId, [...(out.get(r.pageId) ?? []), r.field]);
  return out;
}
