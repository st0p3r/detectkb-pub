import crypto from 'crypto';
import { prisma } from './prisma';
import { kbCache } from './kb-cache';
import { queryText } from './rule-text';

// Lab validation: test runs recorded against rules (usually Atomic Red Team
// tests run in a lab) and the status they give each rule. A result only holds
// for the query that was tested and for a limited time.

export const RUN_RESULTS = ['detected', 'not-detected', 'partial', 'blocked', 'error'] as const;
export type RunResult = (typeof RUN_RESULTS)[number];

/** Results that say something about the rule (blocked / error: the test never really ran). */
const DECISIVE: ReadonlySet<string> = new Set(['detected', 'not-detected', 'partial']);

/** A result older than this needs a re-test (logging, the environment and the rule's filters drift). */
export const VALIDATION_MAX_AGE_DAYS = 90;

export type ValidationStatus = 'validated' | 'partial' | 'failed' | 'stale' | 'never';

export interface RunForStatus {
  result: string;
  executedAt: Date;
  queryHash: string;
  /** Breaks ties between runs at the same time: the one recorded later wins */
  createdAt?: Date;
}

export interface RuleValidation {
  status: ValidationStatus;
  /** Why it is stale */
  reason?: 'query-changed' | 'too-old';
  /** The run the status is based on */
  lastRun?: RunForStatus;
}

/** Hash of the text a rule detects with (rule-text queryText). */
export const ruleQueryHash = (queryText: string) => crypto.createHash('sha256').update(queryText.replace(/\r\n/g, '\n').trim()).digest('hex');

/**
 * The status of a rule from its runs: the latest decisive run counts, as long
 * as the query hasn't changed since and it isn't older than VALIDATION_MAX_AGE_DAYS.
 */
export function validationStatus(runs: RunForStatus[], currentHash: string, now = new Date()): RuleValidation {
  const latest = runs
    .filter((r) => DECISIVE.has(r.result))
    .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime() || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
  if (!latest) return { status: 'never' };
  if (latest.queryHash !== currentHash) return { status: 'stale', reason: 'query-changed', lastRun: latest };
  if (now.getTime() - latest.executedAt.getTime() > VALIDATION_MAX_AGE_DAYS * 86400000) return { status: 'stale', reason: 'too-old', lastRun: latest };
  const status = latest.result === 'detected' ? 'validated' : latest.result === 'partial' ? 'partial' : 'failed';
  return { status, lastRun: latest };
}

/**
 * Every rule's runs and, for rules that have runs, the hash of their current
 * query (cached until data changes). Statuses are computed on read since they age.
 */
const runsCache = kbCache(async () => {
  const runs = await prisma.ruleTestRun.findMany({ select: { pageId: true, result: true, executedAt: true, queryHash: true, createdAt: true } });
  const byPage = new Map<number, RunForStatus[]>();
  for (const r of runs) byPage.set(r.pageId, [...(byPage.get(r.pageId) ?? []), r]);
  const rules = byPage.size
    ? await prisma.detectionRule.findMany({ where: { pageId: { in: Array.from(byPage.keys()) } }, select: { pageId: true, splQuery: true, nativeQuery: true, sigmaYaml: true } })
    : [];
  const hashes = new Map(rules.map((r) => [r.pageId, ruleQueryHash(queryText(r))]));
  return { byPage, hashes };
});

/** A function giving each rule's validation status (rules without runs: never tested). */
export async function loadValidation(now = new Date()): Promise<(pageId: number) => RuleValidation> {
  const { byPage, hashes } = await runsCache.get();
  return (pageId) => {
    const runs = byPage.get(pageId);
    return runs ? validationStatus(runs, hashes.get(pageId) ?? '', now) : { status: 'never' };
  };
}

// ── savedsearches.conf export ───────────────────────────────────────────────

const SPLUNK_SEVERITY: Record<string, number> = { info: 1, low: 2, medium: 3, high: 4, critical: 5 };

/** A stanza name Splunk accepts: no brackets or line breaks. */
const stanzaName = (title: string) => `DetectKB - ${title.replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()}`.slice(0, 200);

/** A multi-line .conf value: every line but the last ends with a backslash. */
const confValue = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join(' \\\n');

export interface ExportRule {
  pageId: number;
  title: string;
  slug: string;
  severity: string;
  techniques: string[];
  splQuery: string;
}

/**
 * The rules as Splunk saved searches (savedsearches.conf) for a lab: each runs
 * every 5 minutes over the last 15 and raises a triggered alert when it finds
 * anything, so a test's result shows in Activity → Triggered Alerts.
 */
export function toSavedSearches(rules: ExportRule[], generatedAt = new Date()): string {
  const used = new Set<string>();
  const stanzas = rules.map((r) => {
    let name = stanzaName(r.title);
    for (let i = 2; used.has(name); i++) name = `${stanzaName(r.title)} (${i})`;
    used.add(name);
    return [
      `[${name}]`,
      `description = DetectKB rule ${r.pageId} (${r.slug})${r.techniques.length ? ` · ${r.techniques.join(', ')}` : ''}`,
      `search = ${confValue(r.splQuery)}`,
      'dispatch.earliest_time = -15m',
      'dispatch.latest_time = now',
      'enableSched = 1',
      'cron_schedule = */5 * * * *',
      'counttype = number of events',
      'relation = greater than',
      'quantity = 0',
      'alert.track = 1',
      `alert.severity = ${SPLUNK_SEVERITY[r.severity] ?? 3}`,
      'alert.suppress = 0',
    ].join('\n');
  });
  return [
    `# DetectKB rules for a test lab — ${rules.length} saved searches, generated ${generatedAt.toISOString()}`,
    '# Put this file in $SPLUNK_HOME/etc/apps/<app>/local/savedsearches.conf of the lab Splunk and restart it.',
    '# ESCU rules need the ES Content Update app (macros) and the CIM app (data models).',
    '',
    stanzas.join('\n\n'),
    '',
  ].join('\n');
}
