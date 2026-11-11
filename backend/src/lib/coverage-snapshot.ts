import { prisma } from './prisma';
import { ATTACK_VERSION, TACTICS } from './attack';
import { loadCoverage, summarizeCoverage } from './attack-coverage';

// The coverage trend: once a day (and whenever asked) the headline numbers of
// the coverage matrix are stored, so "how were we three months ago?" has an
// answer. One row per day; a later snapshot the same day replaces it.

export interface CoverageSnapshotData {
  attackVersion: string | null;
  totalTechniques: number;
  /** Parent techniques with a production or testing rule */
  deployed: number;
  /** …with a production rule */
  production: number;
  /** …with a deployed rule proven in the lab */
  validated: number;
  /** …with a deployed rule whose logs are collected (null until collection is filled in) */
  withLogs: number | null;
  /** …with any rule that isn't deprecated (drafts included) */
  anyRule: number;
  rules: { total: number; byStatus: Record<string, number>; blind: number };
  /** tactic shortname → covered (deployed) / total parent techniques */
  byTactic: Record<string, { covered: number; total: number }>;
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function computeSnapshot(): Promise<CoverageSnapshotData> {
  const [deployed, production, any, withLogs, byStatus] = await Promise.all([
    loadCoverage({ status: 'production,testing', validated: false, withLogs: false }),
    loadCoverage({ status: 'production', validated: false, withLogs: false }),
    loadCoverage({ status: '', validated: false, withLogs: false }),
    loadCoverage({ status: 'production,testing', validated: false, withLogs: true }),
    prisma.detectionRule.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const d = summarizeCoverage(deployed.byTechnique);
  const byTactic: CoverageSnapshotData['byTactic'] = {};
  for (const t of TACTICS) {
    const cells = d.parents.filter((p) => p.tactics.includes(t.shortname));
    byTactic[t.shortname] = { covered: cells.filter((p) => d.parentCounts[p.id]).length, total: cells.length };
  }
  const statusCounts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
  return {
    attackVersion: ATTACK_VERSION,
    totalTechniques: d.totalTechniques,
    deployed: d.coveredTechniques,
    production: summarizeCoverage(production.byTechnique).coveredTechniques,
    validated: d.confidenceCounts.validated,
    withLogs: deployed.collectionActive ? summarizeCoverage(withLogs.byTechnique).coveredTechniques : null,
    anyRule: summarizeCoverage(any.byTechnique).coveredTechniques,
    rules: { total: Object.values(statusCounts).reduce((a, b) => a + b, 0), byStatus: statusCounts, blind: deployed.blindRules },
    byTactic,
  };
}

/** Stores today's numbers (replacing an earlier snapshot of the same day). */
export async function takeSnapshot(now = new Date()) {
  const data = await computeSnapshot();
  const day = dayOf(now);
  const json = data as unknown as object;
  await prisma.coverageSnapshot.upsert({ where: { day }, create: { day, data: json }, update: { data: json } });
  return { day: day.toISOString().slice(0, 10), ...data };
}

/** The last `days` days of snapshots, oldest first. */
export async function loadHistory(days: number) {
  const since = dayOf(new Date(Date.now() - days * 86400000));
  const rows = await prisma.coverageSnapshot.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } });
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), ...(r.data as unknown as CoverageSnapshotData) }));
}
