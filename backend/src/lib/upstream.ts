import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { markDataChanged } from './kb-cache';
import { ArchiveFile, readTarGz, readZip, stripTopFolder } from './archive';
import { ImportFormat, ImportedRule, parseRuleFile } from './rule-import';
import { clipChange, diffImportedRule, ExistingRule } from './rule-import-diff';
import { logEventKey, parseRuleTelemetry } from './log-events';
import { inferSysmonLinks } from './sysmon-links';
import { alternatives, loadRuleTelemetry } from './coverage-analysis';

// Upstream updates: compares the rules in a public repository (or uploaded
// files) with the rules imported from it, so new and changed rules can be
// reviewed and imported. Nothing is imported automatically.

export interface UpstreamSourceDef {
  key: string;
  label: string;
  format: ImportFormat | 'mixed';
  repository?: string;
  /** Choices for `option` (e.g. Sigma packages), first is the default */
  options?: { value: string; label: string }[];
  /** Download URL for the chosen option; none = upload only */
  url?: (option: string) => string;
  archive?: 'zip' | 'tar.gz';
  /** Which files in the archive are rules */
  filter?: (path: string) => boolean;
}

const SIGMA_PACKAGES: Record<string, string> = {
  core: 'sigma_core.zip',
  'core+': 'sigma_core%2B.zip',
  all: 'sigma_all_rules.zip',
};

export const UPSTREAM_SOURCES: UpstreamSourceDef[] = [
  {
    key: 'sigma',
    label: 'SigmaHQ',
    format: 'sigma',
    repository: 'https://github.com/SigmaHQ/sigma',
    options: [
      { value: 'core', label: 'Core (stable and test rules)' },
      { value: 'core+', label: 'Core+ (adds experimental rules)' },
      { value: 'all', label: 'All rules (adds emerging threats and hunting)' },
    ],
    url: (option) => `https://github.com/SigmaHQ/sigma/releases/latest/download/${SIGMA_PACKAGES[option] ?? SIGMA_PACKAGES.core}`,
    archive: 'zip',
    filter: (p) => /\.ya?ml$/i.test(p) && !/deprecated/i.test(p),
  },
  {
    key: 'escu',
    label: 'Splunk security_content (ESCU)',
    format: 'escu',
    repository: 'https://github.com/splunk/security_content',
    url: () => 'https://codeload.github.com/splunk/security_content/tar.gz/refs/heads/develop',
    archive: 'tar.gz',
    filter: (p) => {
      const rel = stripTopFolder(p);
      return rel.startsWith('detections/') && !rel.startsWith('detections/deprecated/') && /\.ya?ml$/i.test(rel);
    },
  },
  {
    key: 'elastic',
    label: 'Elastic detection-rules',
    format: 'elastic',
    repository: 'https://github.com/elastic/detection-rules',
    url: () => 'https://codeload.github.com/elastic/detection-rules/tar.gz/refs/heads/main',
    archive: 'tar.gz',
    filter: (p) => {
      const rel = stripTopFolder(p);
      return rel.startsWith('rules/') && !rel.includes('_deprecated') && /\.toml$/i.test(rel);
    },
  },
  { key: 'upload', label: 'Uploaded files', format: 'mixed' },
];

export const sourceDef = (key: string) => UPSTREAM_SOURCES.find((s) => s.key === key);

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ruleKey = (r: { format: string; externalId: string | null; title: string }) => `${r.format}:${r.externalId ?? `title:${r.title.toLowerCase()}`}`;
export const dismissalKey = (r: { format: string; externalId: string | null; title: string; contentHash: string }) => `${ruleKey(r)}:${r.contentHash}`.slice(0, 250);

/** Downloads a source's package and returns the rule files in it. */
export async function downloadSource(def: UpstreamSourceDef, option: string): Promise<ArchiveFile[]> {
  if (!def.url || !def.archive || !def.filter) throw new Error('This source is upload-only');
  const res = await fetch(def.url(option), { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const files = def.archive === 'zip' ? readZip(buf, { filter: def.filter }) : readTarGz(buf, { filter: def.filter });
  return files.map((f) => ({ ...f, path: def.archive === 'tar.gz' ? stripTopFolder(f.path) : f.path }));
}

/** Telemetry keys a parsed rule depends on, and the AND groups among them. */
export function ruleTelemetry(rule: ImportedRule): { telemetry: string[]; groups: string[][] } {
  const sysmon = inferSysmonLinks({
    title: rule.title,
    type: 'RULE',
    contentMd: rule.contentMd,
    rule: { splQuery: rule.splQuery, dataSource: rule.dataSource, sigmaYaml: rule.sigmaYaml, nativeQuery: rule.nativeQuery },
  });
  const parsed = parseRuleTelemetry({
    sourceFormat: rule.format,
    dataSource: rule.dataSource,
    sourceContent: rule.sourceContent,
    sigmaYaml: rule.sigmaYaml,
    splQuery: rule.splQuery,
    nativeQuery: rule.nativeQuery,
  });
  const telemetry = Array.from(new Set([...Array.from(sysmon.keys(), (id) => `sysmon:${id}`), ...parsed.events.map(logEventKey)]));
  return { telemetry, groups: parsed.groups };
}

/**
 * Whether a rule could run on telemetry the active (production / testing)
 * rules already use: one of its ways of being fed is fully covered. A key
 * "source:*" in use covers every event of that source.
 */
export function isRelevant(t: { telemetry: string[]; groups: string[][] }, inUse: Set<string>): boolean {
  const covered = (k: string) => inUse.has(k) || inUse.has(`${k.slice(0, k.indexOf(':'))}:*`);
  return alternatives(t).some((alt) => alt.length > 0 && alt.every(covered));
}

/** Telemetry keys of active rules: the logs you are evidently collecting. */
export async function telemetryInUse(): Promise<Set<string>> {
  const rules = await loadRuleTelemetry();
  return new Set(rules.filter((r) => r.status === 'production' || r.status === 'testing').flatMap((r) => r.telemetry));
}

type ExistingRow = ExistingRule & { pageId: number; sigmaId: string | null; sourceFormat: string | null; sourceId: string | null };

async function loadExisting() {
  const rows = (await prisma.detectionRule.findMany({
    select: {
      pageId: true,
      sigmaId: true,
      sourceFormat: true,
      sourceId: true,
      splQuery: true,
      severity: true,
      mitreTactics: true,
      mitreTechniques: true,
      dataSource: true,
      falsePositives: true,
      references: true,
      sigmaYaml: true,
      nativeQuery: true,
      page: { select: { title: true, contentMd: true } },
    },
  })) as ExistingRow[];
  const bySigma = new Map<string, ExistingRow>();
  const bySource = new Map<string, ExistingRow>();
  for (const r of rows) {
    if (r.sigmaId) bySigma.set(r.sigmaId, r);
    if (r.sourceFormat && r.sourceId) bySource.set(`${r.sourceFormat}:${r.sourceId}`, r);
  }
  // Same lookup as the importer (routes/rule-import findExisting)
  return (rule: ImportedRule) =>
    !rule.externalId ? undefined : rule.format === 'sigma' ? bySigma.get(rule.externalId) : bySource.get(`${rule.format}:${rule.externalId}`);
}

export interface CheckStats {
  files: number;
  rules: number;
  new: number;
  relevantNew: number;
  changed: number;
  unchanged: number;
  dismissed: number;
  errors: number;
}

/** Compares files with the imported rules and replaces the source's items with the result. */
export async function checkFiles(sourceKey: string, files: ArchiveFile[]): Promise<CheckStats> {
  const [findExisting, inUse, dismissals] = await Promise.all([
    loadExisting(),
    telemetryInUse(),
    prisma.upstreamDismissal.findMany({ select: { key: true } }).then((d) => new Set(d.map((x) => x.key))),
  ]);
  const stats: CheckStats = { files: files.length, rules: 0, new: 0, relevantNew: 0, changed: 0, unchanged: 0, dismissed: 0, errors: 0 };
  const items: Prisma.UpstreamItemCreateManyInput[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const contentHash = hash(file.content);
    for (const entry of parseRuleFile(file.path, file.content)) {
      const rule = entry.rule;
      if (!rule?.title) {
        stats.errors++;
        continue;
      }
      const key = ruleKey(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      stats.rules++;
      const existing = findExisting(rule);
      const changes = existing ? diffImportedRule(rule, existing) : [];
      if (existing && !changes.length) {
        stats.unchanged++;
        continue;
      }
      // Rules the source itself retired are only interesting as updates of ones you have
      if (!existing && rule.sourceStatus === 'deprecated') continue;
      if (dismissals.has(dismissalKey({ ...rule, contentHash }))) {
        stats.dismissed++;
        continue;
      }
      const t = ruleTelemetry(rule);
      const relevant = isRelevant(t, inUse);
      if (existing) stats.changed++;
      else {
        stats.new++;
        if (relevant) stats.relevantNew++;
      }
      items.push({
        sourceKey,
        kind: existing ? 'changed' : 'new',
        format: rule.format,
        externalId: rule.externalId,
        title: rule.title.slice(0, 500),
        path: file.path.slice(0, 500),
        content: file.content,
        contentHash,
        pageId: existing?.pageId ?? null,
        changes: existing ? (changes.map((c) => ({ ...c, ...clipChange(c.before, c.after) })) as Prisma.InputJsonValue) : Prisma.JsonNull,
        severity: rule.severity,
        sourceStatus: rule.sourceStatus,
        techniques: rule.mitreTechniques,
        telemetry: t.telemetry as Prisma.InputJsonValue,
        relevant,
      });
    }
  }

  await prisma.upstreamSource.upsert({ where: { key: sourceKey }, create: { key: sourceKey }, update: {} });
  await prisma.$transaction(async (tx) => {
    await tx.upstreamItem.deleteMany({ where: { sourceKey } });
    for (let i = 0; i < items.length; i += 100) await tx.upstreamItem.createMany({ data: items.slice(i, i + 100) });
    await tx.upstreamSource.update({
      where: { key: sourceKey },
      data: { lastCheckedAt: new Date(), lastError: null, stats: stats as unknown as Prisma.InputJsonValue },
    });
  }, { timeout: 120000 });
  // Data Health lists rules changed upstream (checks run in the background, after their request)
  markDataChanged();
  return stats;
}

/** Whether a source is checked: as configured, else when rules of its format were imported. */
export async function sourceEnabled(def: UpstreamSourceDef, row: { enabled: boolean } | null): Promise<boolean> {
  if (row) return row.enabled;
  if (def.format === 'mixed') return false;
  return (await prisma.detectionRule.count({ where: { sourceFormat: def.format } })) > 0;
}

const running = new Set<string>();
export const isRunning = (key: string) => running.has(key);

/** Downloads and checks one source; errors are stored on the source. */
export async function checkSource(key: string): Promise<CheckStats> {
  const def = sourceDef(key);
  if (!def?.url) throw new Error('Unknown or upload-only source');
  if (running.has(key)) throw new Error('A check of this source is already running');
  running.add(key);
  try {
    const row = await prisma.upstreamSource.findUnique({ where: { key } });
    const option = row?.option ?? def.options?.[0]?.value ?? '';
    const files = await downloadSource(def, option);
    return await checkFiles(key, files);
  } catch (err) {
    await prisma.upstreamSource.upsert({
      where: { key },
      create: { key, lastError: (err as Error).message, lastCheckedAt: new Date() },
      update: { lastError: (err as Error).message, lastCheckedAt: new Date() },
    });
    throw err;
  } finally {
    running.delete(key);
  }
}

export const AUTO_CHECK_DAYS = 7;

/** Checks enabled sources not checked for AUTO_CHECK_DAYS (background, at most one at a time). */
export async function checkStaleSources(): Promise<void> {
  const rows = new Map((await prisma.upstreamSource.findMany()).map((r) => [r.key, r]));
  for (const def of UPSTREAM_SOURCES.filter((d) => d.url)) {
    const row = rows.get(def.key) ?? null;
    if (!(await sourceEnabled(def, row))) continue;
    if (row?.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < AUTO_CHECK_DAYS * 86400000) continue;
    try {
      const s = await checkSource(def.key);
      console.log(`[upstream] ${def.label}: ${s.new} new (${s.relevantNew} for your telemetry), ${s.changed} changed`);
    } catch (err) {
      console.warn(`[upstream] ${def.label}: ${(err as Error).message}`);
    }
  }
}
