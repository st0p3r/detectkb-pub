import { prisma } from './prisma';
import { logEventKey, parseDataSourcePage, parseRuleTelemetry, type ParsedLogEvent } from './log-events';

// Keeps PageLogEvent (rule / data source page → log events) in step with the
// pages: recomputed when a page is saved or imported, and for every page at startup.

const ruleSelect = {
  id: true,
  title: true,
  type: true,
  contentMd: true,
  rule: { select: { sourceFormat: true, dataSource: true, sourceContent: true, sigmaYaml: true, splQuery: true, nativeQuery: true } },
} as const;

type PageRow = { id: number; title: string; type: string; contentMd: string; rule: Parameters<typeof parseRuleTelemetry>[0] | null };

function eventsOf(page: PageRow): ParsedLogEvent[] {
  if (page.rule) return parseRuleTelemetry(page.rule).events;
  if (page.type === 'DATA_SOURCE') return parseDataSourcePage(page.title, page.contentMd);
  return [];
}

/** LogEvent IDs for the given events, creating the missing ones. */
async function ensureLogEvents(events: ParsedLogEvent[]): Promise<Map<string, number>> {
  const byKey = new Map(events.map((e) => [logEventKey(e), e]));
  if (!byKey.size) return new Map();
  const keys = Array.from(byKey.keys());
  const existing = await prisma.logEvent.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  const have = new Set(existing.map((e) => e.key));
  const missing = keys.filter((k) => !have.has(k));
  if (missing.length) {
    await prisma.logEvent.createMany({
      data: missing.map((key) => {
        const e = byKey.get(key)!;
        return { key, source: e.source.slice(0, 60), sourceLabel: e.sourceLabel.slice(0, 120), code: e.code.slice(0, 120), name: e.name.slice(0, 255) };
      }),
      skipDuplicates: true,
    });
  }
  const all = missing.length ? await prisma.logEvent.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } }) : existing;
  return new Map(all.map((e) => [e.key, e.id]));
}

async function applyLinks(desiredByPage: Map<number, Set<number>>, pageIds: number[]) {
  const existing = await prisma.pageLogEvent.findMany({ where: { pageId: { in: pageIds }, source: 'auto' } });
  const current = new Map<number, Set<number>>();
  for (const l of existing) {
    if (!current.has(l.pageId)) current.set(l.pageId, new Set());
    current.get(l.pageId)!.add(l.logEventId);
  }
  const stale: { pageId: number; logEventId: number }[] = [];
  const added: { pageId: number; logEventId: number; source: string }[] = [];
  for (const pageId of pageIds) {
    const want = desiredByPage.get(pageId) ?? new Set<number>();
    const have = current.get(pageId) ?? new Set<number>();
    for (const id of have) if (!want.has(id)) stale.push({ pageId, logEventId: id });
    for (const id of want) if (!have.has(id)) added.push({ pageId, logEventId: id, source: 'auto' });
  }
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.pageLogEvent.deleteMany({ where: { OR: stale.slice(i, i + 500) } });
  }
  for (let i = 0; i < added.length; i += 1000) {
    await prisma.pageLogEvent.createMany({ data: added.slice(i, i + 1000), skipDuplicates: true });
  }
  return { added: added.length, removed: stale.length };
}

async function sync(pages: PageRow[]) {
  const eventsByPage = new Map(pages.map((p) => [p.id, eventsOf(p)]));
  const ids = await ensureLogEvents(Array.from(eventsByPage.values()).flat());
  const desired = new Map(Array.from(eventsByPage, ([pageId, events]) => [pageId, new Set(events.map((e) => ids.get(logEventKey(e))!))]));
  const result = await applyLinks(desired, pages.map((p) => p.id));
  // Events no page uses any more (e.g. after a rule was edited) are dropped
  await prisma.logEvent.deleteMany({ where: { pages: { none: {} } } });
  return result;
}

/** Recomputes the log events of one page (after it is saved or imported). */
export async function syncLogLinks(pageId: number): Promise<void> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: ruleSelect });
  if (page) await sync([page]);
}

/** Recomputes the log events of every rule and data source page (startup, restore). */
export async function syncAllLogLinks(): Promise<{ added: number; removed: number }> {
  const pages = await prisma.page.findMany({
    where: { OR: [{ rule: { isNot: null } }, { type: 'DATA_SOURCE' }] },
    select: ruleSelect,
  });
  return sync(pages);
}
