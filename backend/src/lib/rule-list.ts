import type { Prisma } from '@prisma/client';

// Query building for the paged rule list (GET /api/rules?page=…).

export const RULE_STATUSES = ['draft', 'testing', 'production', 'deprecated'];
export const RULE_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
export const SORT_KEYS = ['title', 'status', 'severity', 'updatedAt'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const MAX_PAGE_SIZE = 200;

export interface RuleListQuery {
  q?: string;
  status?: string;
  severity?: string;
  source?: string;
  technique?: string;
  tactic?: string;
  dataSource?: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function parseRuleListQuery(query: Record<string, unknown>): RuleListQuery {
  const sort = SORT_KEYS.includes(query.sort as SortKey) ? (query.sort as SortKey) : 'updatedAt';
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : sort === 'updatedAt' ? 'desc' : 'asc';
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const pageSize = Math.min(Math.max(1, Math.floor(Number(query.pageSize)) || 50), MAX_PAGE_SIZE);
  return {
    q: str(query.q),
    status: str(query.status),
    severity: str(query.severity),
    source: str(query.source),
    technique: str(query.technique),
    tactic: str(query.tactic),
    dataSource: str(query.dataSource),
    sort,
    dir,
    page,
    pageSize,
  };
}

/** Where clause for the filters; `omit` leaves one out (for the status chip counts). */
export function ruleWhere(f: RuleListQuery, omit?: 'status'): Prisma.DetectionRuleWhereInput {
  const and: Prisma.DetectionRuleWhereInput[] = [];
  if (f.status && omit !== 'status') and.push({ status: { in: f.status.split(',') } });
  if (f.severity) and.push({ severity: { in: f.severity.split(',') } });
  if (f.source === 'manual') and.push({ sourceFormat: null });
  else if (f.source) and.push({ sourceFormat: f.source });
  if (f.technique) and.push({ mitreTechniques: { contains: f.technique } });
  if (f.tactic) and.push({ mitreTactics: { contains: f.tactic } });
  if (f.dataSource) and.push({ dataSource: { contains: f.dataSource } });
  if (f.q) {
    // MySQL's default collation makes `contains` case-insensitive
    and.push({
      OR: [
        { page: { title: { contains: f.q } } },
        { mitreTechniques: { contains: f.q } },
        { dataSource: { contains: f.q } },
        { sigmaId: { contains: f.q } },
        { sourceId: { contains: f.q } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export function ruleOrderBy(sort: SortKey, dir: 'asc' | 'desc'): Prisma.DetectionRuleOrderByWithRelationInput[] {
  const recent = { page: { updatedAt: 'desc' as const } };
  if (sort === 'title') return [{ page: { title: dir } }, { id: 'asc' }];
  if (sort === 'updatedAt') return [{ page: { updatedAt: dir } }, { id: 'asc' }];
  return [{ [sort]: dir }, recent, { id: 'asc' }];
}

/**
 * Status and severity sort in their natural order (draft → deprecated,
 * info → critical), which SQL can't do on a VARCHAR column. With the count of
 * rules per value, this works out which values a page spans and the
 * skip/take to read from each, so every slice is an ordinary indexed query.
 */
export function enumSlices(
  order: string[],
  counts: Map<string, number>,
  skip: number,
  take: number
): { value: string | { notIn: string[] }; skip: number; take: number }[] {
  // Values outside the known order (hand-edited data) go last, as one bucket
  const known = order.filter((v) => counts.has(v));
  const otherCount = Array.from(counts.entries())
    .filter(([v]) => !order.includes(v))
    .reduce((n, [, c]) => n + c, 0);
  const buckets: { value: string | { notIn: string[] }; count: number }[] = known.map((v) => ({ value: v, count: counts.get(v)! }));
  if (otherCount) buckets.push({ value: { notIn: order }, count: otherCount });

  const slices = [];
  let offset = 0;
  for (const b of buckets) {
    if (take <= 0) break;
    const start = Math.max(skip - offset, 0);
    if (start < b.count) {
      const n = Math.min(b.count - start, take);
      slices.push({ value: b.value, skip: start, take: n });
      take -= n;
      skip = offset + start + n;
    }
    offset += b.count;
  }
  return slices;
}

export const RULE_LIST_SELECT = {
  id: true,
  pageId: true,
  status: true,
  severity: true,
  mitreTactics: true,
  mitreTechniques: true,
  dataSource: true,
  sigmaId: true,
  sourceFormat: true,
  sourceId: true,
  nativeLanguage: true,
  page: {
    select: { id: true, title: true, slug: true, type: true, updatedAt: true, tags: { include: { tag: true } } },
  },
} satisfies Prisma.DetectionRuleSelect;
