import { prisma } from './prisma';
import { kbCache } from './kb-cache';
import { RuleTelemetry, loadRuleTelemetry, loadTelemetryInfo } from './coverage-analysis';
import { queryText } from './rule-text';

// Similar rules: active rules mapped to exactly the same ATT&CK techniques and
// reading exactly the same telemetry. They overlap in what they can detect, so
// they are candidates to merge or retire — not necessarily duplicates. Within
// a group, rules are compared by the words of their query and title, weighted
// by how rare each word is across all rules (so SPL boilerplate such as
// `tstats` or `summariesonly` counts for little and process names, paths and
// command-line switches count for a lot).

/** Groups at least this alike are flagged as likely overlaps (Data Health, summary) */
export const LIKELY_OVERLAP = 0.7;

const TOKEN = /[a-z0-9][a-z0-9_.\\/-]{2,}/g;

export function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(TOKEN) ?? []).map((t) => t.replace(/[.\\/-]+$/, '')).filter((t) => t.length >= 3));
}

/** Weighted Jaccard of two token sets: the rarer a shared word, the more it counts. */
export function similarity(a: Set<string>, b: Set<string>, weight: (t: string) => number): number {
  let inter = 0;
  let union = 0;
  for (const t of a) {
    const w = weight(t);
    union += w;
    if (b.has(t)) inter += w;
  }
  for (const t of b) if (!a.has(t)) union += weight(t);
  return union ? inter / union : 0;
}

export interface SimilarRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  sourceFormat: string | null;
  /** The most similar other rule of the group */
  closest: { pageId: number; similarity: number } | null;
}

interface Group<T> {
  key: string;
  techniques: string[];
  telemetry: T[];
  /** Highest similarity between two rules of the group (0–1) */
  similarity: number;
  /** Rules come from more than one source (e.g. ESCU and Sigma) */
  crossSource: boolean;
  rules: SimilarRule[];
}

export type SimilarGroup = Group<{ key: string; label: string }>;

/** Groups rules with identical (non-empty) technique and telemetry sets; pure, for tests. */
export function groupSimilar(
  rules: Pick<RuleTelemetry, 'pageId' | 'title' | 'slug' | 'status' | 'severity' | 'sourceFormat' | 'techniques' | 'telemetry'>[],
  texts: Map<number, string>
): Group<string>[] {
  const active = rules.filter((r) => r.status !== 'deprecated' && r.techniques.length && r.telemetry.length);
  const byKey = new Map<string, typeof active>();
  for (const r of active) {
    const key = `${[...new Set(r.techniques)].sort().join(',')}|${[...new Set(r.telemetry)].sort().join(',')}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }

  // Word rarity over every active rule
  const tokensOf = new Map(active.map((r) => [r.pageId, tokens(`${r.title}\n${texts.get(r.pageId) ?? ''}`)]));
  const df = new Map<string, number>();
  for (const set of tokensOf.values()) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(active.length, 1);
  const weight = (t: string) => Math.log(1 + n / (df.get(t) ?? 1));

  const groups: Group<string>[] = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const closest = new Map<number, { pageId: number; similarity: number }>();
    let best = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        const s = similarity(tokensOf.get(a.pageId)!, tokensOf.get(b.pageId)!, weight);
        best = Math.max(best, s);
        if (s > (closest.get(a.pageId)?.similarity ?? -1)) closest.set(a.pageId, { pageId: b.pageId, similarity: s });
        if (s > (closest.get(b.pageId)?.similarity ?? -1)) closest.set(b.pageId, { pageId: a.pageId, similarity: s });
      }
    }
    const [techniques, telemetry] = key.split('|');
    groups.push({
      key,
      techniques: techniques.split(','),
      telemetry: telemetry.split(','),
      similarity: best,
      crossSource: new Set(members.map((m) => m.sourceFormat ?? 'manual')).size > 1,
      rules: members
        .map((m) => ({
          pageId: m.pageId,
          title: m.title,
          slug: m.slug,
          status: m.status,
          severity: m.severity,
          sourceFormat: m.sourceFormat,
          closest: closest.get(m.pageId) ?? null,
        }))
        .sort((x, y) => (y.closest?.similarity ?? 0) - (x.closest?.similarity ?? 0) || x.title.localeCompare(y.title)),
    });
  }
  return groups.sort((a, b) => b.similarity - a.similarity || b.rules.length - a.rules.length);
}

const similarCache = kbCache(
  async (): Promise<SimilarGroup[]> => {
    const [rules, info] = await Promise.all([loadRuleTelemetry(), loadTelemetryInfo()]);
    const rows = await prisma.detectionRule.findMany({
      where: { status: { not: 'deprecated' } },
      select: { pageId: true, splQuery: true, nativeQuery: true, sigmaYaml: true },
    });
    const texts = new Map(rows.map((r) => [r.pageId, queryText(r)]));
    return groupSimilar(rules, texts).map((g) => ({ ...g, telemetry: g.telemetry.map((key) => ({ key, label: info.get(key)?.label ?? key })) }));
  },
  undefined,
  { warm: true, label: 'similar rules' }
);

/** Every group of similar rules (cached until data changes). */
export function loadSimilarGroups(): Promise<SimilarGroup[]> {
  return similarCache.get();
}
