import { prisma } from './prisma';
import { kbCacheMap } from './kb-cache';
import { TECHNIQUES, onPlatforms, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from './attack';
import { ValidationStatus, loadValidation } from './validation';
import { CONFIDENCE_LEVELS, CoverageConfidence, bestConfidence } from './coverage-confidence';
import { RuleFeed, loadRuleFeeds } from './collection';

// ATT&CK coverage: which rules reference which technique, for a status filter,
// optionally only rules proven in the lab and only rules whose logs are
// collected. Used by the coverage matrix, the Navigator export and the daily
// snapshots.

export interface CoveringRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  /** Lab validation status (lib/validation) */
  validation: ValidationStatus;
  /** Whether its logs are collected (lib/collection) */
  feed: RuleFeed;
}

export interface CoverageOptions {
  /** "production,testing", "all", or "" for every status except deprecated */
  status: string;
  /** Only rules a lab test showed firing */
  validated: boolean;
  /** Leave out rules whose logs aren't collected */
  withLogs: boolean;
}

/** ?status=production,testing — defaults to every status except deprecated. */
function statusFilter(raw: string) {
  if (raw === 'all') return {};
  if (raw) return { status: { in: raw.split(',').map((s) => s.trim()).filter(Boolean) } };
  return { status: { not: 'deprecated' } };
}

export const normalizeStatus = (raw: string) => (raw === 'all' ? raw : raw.split(',').map((s) => s.trim()).filter(Boolean).sort().join(','));

// Coverage per filter (cached until data changes; shared, so read-only)
const coverageCache = kbCacheMap(
  (key) => {
    const [status, validated, withLogs] = key.split('|');
    return buildCoverage({ status, validated: validated === '1', withLogs: withLogs === '1' });
  },
  { warm: true, label: 'ATT&CK coverage' }
);

export function loadCoverage(opts: CoverageOptions) {
  return coverageCache.get(`${normalizeStatus(opts.status)}|${opts.validated ? 1 : 0}|${opts.withLogs ? 1 : 0}`);
}

/** technique ID → rules that reference it (IDs not in ATT&CK are returned separately). */
async function buildCoverage(opts: CoverageOptions) {
  const [validation, feeds] = await Promise.all([loadValidation(), loadRuleFeeds()]);
  const all = await prisma.detectionRule.findMany({
    where: statusFilter(opts.status),
    select: {
      status: true,
      severity: true,
      mitreTechniques: true,
      page: { select: { id: true, title: true, slug: true } },
    },
  });
  const matching = opts.validated ? all.filter((r) => validation(r.page.id).status === 'validated') : all;
  // Rules that can't fire because their logs aren't collected
  const blindRules = matching.filter((r) => feeds.feed(r.page.id) === 'blind').length;
  const rules = opts.withLogs ? matching.filter((r) => feeds.feed(r.page.id) !== 'blind') : matching;

  const byTechnique = new Map<string, CoveringRule[]>();
  const unknown = new Map<string, CoveringRule[]>();
  // Retired IDs still used by rules, e.g. T1562.001 → T1685
  const retired = new Map<string, { replacedBy: string; rules: CoveringRule[] }>();
  for (const r of rules) {
    const info: CoveringRule = {
      pageId: r.page.id,
      title: r.page.title,
      slug: r.page.slug,
      status: r.status,
      severity: r.severity,
      validation: validation(r.page.id).status,
      feed: feeds.feed(r.page.id),
    };
    for (const rawId of parseTechniqueIds(r.mitreTechniques)) {
      const id = resolveTechniqueId(rawId);
      if (!id) {
        if (!unknown.has(rawId)) unknown.set(rawId, []);
        unknown.get(rawId)!.push(info);
        continue;
      }
      if (id !== rawId) {
        if (!retired.has(rawId)) retired.set(rawId, { replacedBy: id, rules: [] });
        retired.get(rawId)!.rules.push(info);
      }
      if (!byTechnique.has(id)) byTechnique.set(id, []);
      const list = byTechnique.get(id)!;
      if (!list.some((x) => x.pageId === info.pageId)) list.push(info);
    }
  }
  return { ruleCount: rules.length, blindRules, collectionActive: feeds.active, byTechnique, unknown, retired };
}

export type Coverage = Awaited<ReturnType<typeof buildCoverage>>;

/**
 * The matrix numbers: per technique and per parent cell (the technique and
 * its sub-techniques, each rule once) the rule count, the best confidence and
 * how many of the rules are blind. With `platforms`, techniques outside them
 * are left out of the counts and the totals.
 */
export function summarizeCoverage(byTechnique: ReadonlyMap<string, CoveringRule[]>, platforms?: ReadonlySet<string> | null) {
  const inScope = Array.from(byTechnique).filter(([id]) => onPlatforms(id, platforms) && onPlatforms(parentTechniqueId(id), platforms));
  const parentRules = new Map<string, Map<number, CoveringRule>>();
  for (const [id, rules] of inScope) {
    const parent = parentTechniqueId(id);
    if (!parentRules.has(parent)) parentRules.set(parent, new Map());
    for (const r of rules) parentRules.get(parent)!.set(r.pageId, r);
  }
  const blindCount = (rules: Iterable<CoveringRule>) => {
    let n = 0;
    for (const r of rules) if (r.feed === 'blind') n++;
    return n;
  };
  const parentConfidence = Object.fromEntries(Array.from(parentRules, ([id, rules]) => [id, bestConfidence(rules.values())]));
  const confidenceCounts = Object.fromEntries(CONFIDENCE_LEVELS.map((l) => [l, 0])) as Record<CoverageConfidence, number>;
  for (const level of Object.values(parentConfidence)) if (level) confidenceCounts[level]++;
  const parentBlind = Object.fromEntries(Array.from(parentRules, ([id, rules]) => [id, blindCount(rules.values())]).filter(([, n]) => n));
  const parents = TECHNIQUES.filter((t) => !t.id.includes('.') && onPlatforms(t.id, platforms));
  return {
    counts: Object.fromEntries(inScope.map(([id, rules]) => [id, rules.length])),
    parentCounts: Object.fromEntries(Array.from(parentRules, ([id, rules]) => [id, rules.size])),
    confidence: Object.fromEntries(inScope.map(([id, rules]) => [id, bestConfidence(rules)])),
    parentConfidence,
    /** Parent cell → how many of its rules have no logs */
    parentBlind,
    coveredTechniques: parentRules.size,
    totalTechniques: parents.length,
    confidenceCounts,
    /** Covered parent cells where every rule is blind: covered on paper only */
    blindTechniques: Array.from(parentRules).filter(([, rules]) => blindCount(rules.values()) === rules.size).length,
    parents,
  };
}
