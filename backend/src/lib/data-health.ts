import { prisma } from './prisma';
import { kbCache } from './kb-cache';
import { parseTechniqueIds, resolveTechniqueId, REVOKED_TECHNIQUES, TECHNIQUE_BY_ID } from './attack';
import { otherDataSources } from './coverage-analysis';
import { loadReferenceMatchers, matchText } from './references';
import { queryText } from './rule-text';
import { VALIDATION_MAX_AGE_DAYS, loadValidation } from './validation';

export { queryText };

// Data health: checks on how well the links between rules, techniques,
// telemetry and tools are grounded, and on gaps in the data itself. Computed
// from the database (cached until data changes).

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface HealthItem {
  title: string;
  slug: string;
  detail?: string;
}

export interface HealthCheck {
  id: string;
  title: string;
  description: string;
  severity: CheckSeverity;
  count: number;
  /** First ITEM_LIMIT affected items */
  items: HealthItem[];
  /** Where to see or fix them */
  link?: string;
}

export interface Provenance {
  sysmon: Record<string, number>;
  logs: Record<string, number>;
  tools: { inQuery: number; outsideQuery: number };
}

const ITEM_LIMIT = 100;

const healthCache = kbCache(computeHealth);

export function loadDataHealth() {
  return healthCache.get();
}

async function computeHealth() {
  const [rules, stories, dsPages, matchers] = await Promise.all([
    prisma.detectionRule.findMany({
      select: {
        pageId: true,
        status: true,
        mitreTechniques: true,
        dataSource: true,
        sourceFormat: true,
        falsePositives: true,
        splQuery: true,
        nativeQuery: true,
        sigmaYaml: true,
        page: {
          select: {
            title: true,
            slug: true,
            sysmonEvents: { select: { basis: true, source: true } },
            logEvents: { select: { basis: true } },
            telemetryAll: { select: { keys: true } },
          },
        },
      },
      orderBy: { page: { title: 'asc' } },
    }),
    prisma.analyticStory.findMany({ where: { description: null }, select: { id: true, name: true, _count: { select: { rules: true } } } }),
    prisma.page.findMany({
      where: { type: 'DATA_SOURCE', sysmonEvents: { none: {} }, logEvents: { none: {} } },
      select: { title: true, slug: true },
      orderBy: { title: 'asc' },
    }),
    loadReferenceMatchers(),
  ]);
  const validation = await loadValidation();
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const provenance: Provenance = { sysmon: {}, logs: {}, tools: { inQuery: 0, outsideQuery: 0 } };
  const buckets: Record<string, HealthItem[]> = {};
  const add = (id: string, r: { page: { title: string; slug: string } }, detail?: string) =>
    (buckets[id] ??= []).push({ title: r.page.title, slug: r.page.slug, detail });
  const titles = new Map<string, { title: string; slug: string }[]>();

  for (const r of rules) {
    const raw = parseTechniqueIds(r.mitreTechniques);
    const unknown = raw.filter((id) => !resolveTechniqueId(id));
    const retired = raw.filter((id) => !TECHNIQUE_BY_ID.has(id) && REVOKED_TECHNIQUES[id]);
    if (!raw.length) add('no-technique', r);
    if (unknown.length) add('unknown-technique', r, unknown.join(', '));
    if (retired.length) add('retired-technique', r, retired.map((id) => `${id} → ${REVOKED_TECHNIQUES[id]}`).join(', '));

    for (const l of r.page.sysmonEvents) {
      const b = l.source === 'manual' ? 'manual' : l.basis;
      provenance.sysmon[b] = (provenance.sysmon[b] ?? 0) + 1;
    }
    for (const l of r.page.logEvents) provenance.logs[l.basis] = (provenance.logs[l.basis] ?? 0) + 1;
    const links = [...r.page.sysmonEvents.map((l) => (l.source === 'manual' ? 'manual' : l.basis)), ...r.page.logEvents.map((l) => l.basis)];
    if (!links.length) add('no-telemetry', r, r.dataSource ? `data source: ${r.dataSource}` : 'no data source');
    else if (links.every((b) => b === 'inferred')) add('inferred-only', r);
    const unmapped = otherDataSources(r.dataSource, r.sourceFormat);
    if (unmapped.length) add('unmapped-data-source', r, unmapped.join(', '));
    if (r.page.telemetryAll.length) {
      add('and-requirements', r, r.page.telemetryAll.map((g) => (Array.isArray(g.keys) ? g.keys.join(' + ') : '')).join(' · '));
    }

    // Tools found in the rule's text but not in its query: named in a title or description only
    const full = matchText(matchers, [r.page.title, r.splQuery, r.nativeQuery ?? '', r.sigmaYaml ?? ''].join('\n'));
    if (full.size) {
      const inQuery = matchText(matchers, queryText(r));
      const outside: string[] = [];
      for (const [kind, keys] of full) {
        for (const key of keys) {
          if (inQuery.get(kind)?.has(key)) provenance.tools.inQuery++;
          else {
            provenance.tools.outsideQuery++;
            outside.push(key);
          }
        }
      }
      if (outside.length) add('tool-outside-query', r, outside.join(', '));
    }

    if (r.status === 'production' && !r.falsePositives?.trim()) add('production-no-fp', r);
    if (r.status !== 'deprecated') {
      const v = validation(r.pageId);
      if (v.status === 'failed') add('validation-failed', r, `not detected on ${day(v.lastRun!.executedAt)}`);
      else if (v.status === 'stale')
        add('validation-stale', r, v.reason === 'query-changed' ? `query changed since the test on ${day(v.lastRun!.executedAt)}` : `last tested ${day(v.lastRun!.executedAt)}`);
      else if (v.status === 'never' && r.status === 'production') add('production-untested', r);
    }
    const t = r.page.title.trim().toLowerCase();
    titles.set(t, [...(titles.get(t) ?? []), r.page]);
  }
  for (const list of titles.values()) {
    if (list.length > 1) for (const p of list) (buckets['duplicate-title'] ??= []).push({ title: p.title, slug: p.slug, detail: `${list.length} rules` });
  }

  const check = (id: string, severity: CheckSeverity, title: string, description: string, link?: string): HealthCheck => {
    const items = buckets[id] ?? [];
    return { id, severity, title, description, count: items.length, items: items.slice(0, ITEM_LIMIT), link };
  };

  const checks: HealthCheck[] = [
    check('unknown-technique', 'error', 'Unknown ATT&CK IDs', 'Rules mapped to technique IDs that do not exist in ATT&CK (typos, or deprecated without a replacement). They count toward no technique.'),
    check('no-telemetry', 'warning', 'Rules without any telemetry link', 'No Sysmon or log event could be linked, so impact analysis, flows and the detection chain leave them out. Name the telemetry in the rule\'s Data source field.'),
    check('validation-failed', 'warning', 'Rules that did not fire in the lab', 'The latest lab test of these rules did not detect the attack: the rule, its telemetry or the lab needs a look.', '/atomic-tests'),
    check('tool-outside-query', 'warning', 'Tool matches outside the query', 'An attacker tool is named in the rule\'s title or description but not in its query or detection — the rule may not actually detect it.'),
    check('no-technique', 'warning', 'Rules without an ATT&CK technique', 'They are missing from the coverage matrix, threat group coverage and the detection chain.'),
    check('retired-technique', 'warning', 'Retired ATT&CK IDs', 'Counted under MITRE\'s replacement technique; update the mapping.', '/attack-coverage'),
    check('inferred-only', 'info', 'Telemetry only inferred', 'Every telemetry link of these rules was derived by DetectKB (EventID filters in the query, Sigma category mapping), none is named by the rule itself.'),
    check('and-requirements', 'info', 'Rules needing several events at once', 'Their data source says "A AND B": impact analysis counts them lost when any of those events is gone.'),
    check('unmapped-data-source', 'info', 'Data sources DetectKB does not know', 'Names in the rule\'s Data source field that are not linked to a log source; impact analysis marks such rules "at risk" instead of "lost".', '/log-sources'),
    check('validation-stale', 'info', 'Lab results to redo', `The query changed after the rule was tested, or the test is older than ${VALIDATION_MAX_AGE_DAYS} days.`),
    check('production-untested', 'info', 'Production rules never tested in the lab', 'No lab test result is recorded for them; the Atomic Red Team section of each rule lists tests to run.', '/atomic-tests'),
    check('production-no-fp', 'info', 'Production rules without false positives', 'No false-positive notes for analysts.'),
    check('duplicate-title', 'info', 'Rules with the same title', 'Often the same detection imported from two sources.'),
  ];
  checks.push({
    id: 'stories-no-details',
    severity: 'info',
    title: 'Analytic stories without a description',
    description: 'Download the descriptions or upload the story files on the Analytic Stories page.',
    count: stories.length,
    items: stories.slice(0, ITEM_LIMIT).map((s) => ({ title: s.name, slug: '', detail: `${s._count.rules} rules` })),
    link: '/analytic-stories',
  });
  checks.push({
    id: 'ds-pages-no-telemetry',
    severity: 'info',
    title: 'Data source pages without telemetry',
    description: 'Data source pages that name no Sysmon or log event; they are not used by impact analysis or the detection chain.',
    count: dsPages.length,
    items: dsPages.slice(0, ITEM_LIMIT).map((p) => ({ title: p.title, slug: p.slug })),
  });

  return { generatedAt: new Date().toISOString(), rules: rules.length, provenance, checks };
}
