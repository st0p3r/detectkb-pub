import { prisma } from './prisma';
import { TACTICS, TECHNIQUE_BY_ID, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from './attack';
import { MITIGATIONS_BY_TECHNIQUE, attackObjectUrl } from './attack-cti';
import { TECHNIQUE_DETAILS } from './attack-details';
import { loadRuleTelemetry, loadTelemetryInfo } from './coverage-analysis';
import { keyState, loadCollection, ruleFeed } from './collection';
import { loadValidation } from './validation';
import { importedGuide, overview } from './runbook';

// Everything the analyst handling a rule's alert needs on one page, put
// together from the rule, its page, ATT&CK and what is known about its logs.

const STATUS_RANK: Record<string, number> = { production: 0, testing: 1, draft: 2, deprecated: 3 };
const lines = (text: string | null) =>
  (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);

export async function buildRunbook(pageId: number) {
  const rule = await prisma.detectionRule.findUnique({
    where: { pageId },
    include: {
      owner: { select: { id: true, username: true } },
      page: { select: { id: true, title: true, slug: true, contentMd: true, updatedAt: true, tags: { select: { tag: { select: { name: true, color: true } } } } } },
    },
  });
  if (!rule) return null;

  const [allRules, info, collection, validation] = await Promise.all([loadRuleTelemetry(), loadTelemetryInfo(), loadCollection(), loadValidation()]);
  const telemetry = allRules.find((r) => r.pageId === pageId);
  const guide = importedGuide(rule.page.contentMd);
  const steps = (own: string | null, imported: string | null) =>
    own?.trim() ? { source: 'rule' as const, markdown: own.trim() } : imported ? { source: 'imported' as const, markdown: imported } : null;

  const techniqueIds = Array.from(new Set(parseTechniqueIds(rule.mitreTechniques).map(resolveTechniqueId).filter((t): t is string => !!t)));
  const tacticName = (shortname: string) => TACTICS.find((t) => t.shortname === shortname)?.name ?? shortname;
  const techniques = techniqueIds.map((id) => {
    const t = TECHNIQUE_BY_ID.get(id);
    const detail = TECHNIQUE_DETAILS.get(id);
    // A sub-technique without its own mitigations: the parent's still apply
    const mitigations = MITIGATIONS_BY_TECHNIQUE.get(id) ?? MITIGATIONS_BY_TECHNIQUE.get(parentTechniqueId(id)) ?? [];
    return {
      id,
      name: t?.name ?? id,
      tactics: (t?.tactics ?? []).map(tacticName),
      platforms: t?.platforms ?? [],
      url: attackObjectUrl(id),
      description: detail?.description ?? null,
      analytics: (detail?.detection ?? []).flatMap((d) => d.analytics),
      mitigations: mitigations.map((m) => ({ id: m.id, name: m.name, description: m.description, url: attackObjectUrl(m.id) })),
    };
  });

  const related = allRules
    .filter((r) => r.pageId !== pageId && r.status !== 'deprecated' && r.techniques.some((t) => techniqueIds.includes(t)))
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.title.localeCompare(b.title));

  const v = validation(pageId);
  return {
    pageId,
    ruleId: rule.id,
    title: rule.page.title,
    slug: rule.page.slug,
    status: rule.status,
    severity: rule.severity,
    updatedAt: rule.page.updatedAt,
    tags: rule.page.tags.map((t) => t.tag),
    owner: rule.owner,
    lastReviewedAt: rule.lastReviewedAt,
    nextReviewAt: rule.nextReviewAt,
    overview: overview(rule.page.contentMd),
    /** source: written on the rule, or taken from the investigation guide the rule was imported with */
    triage: steps(rule.triage, guide.triage),
    response: steps(rule.response, guide.response),
    falsePositives: lines(rule.falsePositives),
    references: lines(rule.references),
    queries: { spl: rule.splQuery.trim() || null, native: rule.nativeQuery?.trim() || null, nativeLanguage: rule.nativeLanguage },
    dataSource: rule.dataSource,
    techniques,
    logs: {
      /** Whether anyone said which logs are collected */
      known: collection.size > 0,
      feed: telemetry ? ruleFeed(telemetry, collection) : 'unknown',
      telemetry: (telemetry?.telemetry ?? []).map((key) => ({ key, label: info.get(key)?.label ?? key, state: keyState(collection, key) })),
    },
    validation: { status: v.status, reason: v.reason ?? null, testedAt: v.lastRun?.executedAt ?? null },
    relatedTotal: related.length,
    related: related.slice(0, 8).map((r) => ({ pageId: r.pageId, title: r.title, slug: r.slug, status: r.status, severity: r.severity })),
  };
}
