import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { logEventKey, parseDataSourcePage, parseRuleTelemetry, type ParsedLogEvent } from './log-events';

// Keeps PageLogEvent (rule / data source page → log events, with the basis of
// each link) and TelemetryGroup (telemetry a rule needs all at once) in step
// with the pages: recomputed when a page is saved or imported, and for every
// page at startup.

const ruleSelect = {
  id: true,
  title: true,
  type: true,
  contentMd: true,
  rule: { select: { sourceFormat: true, dataSource: true, sourceContent: true, sigmaYaml: true, splQuery: true, nativeQuery: true } },
} as const;

type PageRow = { id: number; title: string; type: string; contentMd: string; rule: Parameters<typeof parseRuleTelemetry>[0] | null };

function parsed(page: PageRow): { events: ParsedLogEvent[]; groups: string[][] } {
  if (page.rule) return parseRuleTelemetry(page.rule);
  if (page.type === 'DATA_SOURCE') return { events: parseDataSourcePage(page.title, page.contentMd), groups: [] };
  return { events: [], groups: [] };
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

/** desiredByPage: pageId → (logEventId → basis) */
async function applyLinks(desiredByPage: Map<number, Map<number, string>>, pageIds: number[]) {
  const existing = await prisma.pageLogEvent.findMany({ where: { pageId: { in: pageIds }, source: 'auto' } });
  const current = new Map<number, Map<number, string>>();
  for (const l of existing) {
    if (!current.has(l.pageId)) current.set(l.pageId, new Map());
    current.get(l.pageId)!.set(l.logEventId, l.basis);
  }
  const stale: { pageId: number; logEventId: number }[] = [];
  const added: { pageId: number; logEventId: number; source: string; basis: string }[] = [];
  const rebased: { pageId: number; logEventId: number; basis: string }[] = [];
  for (const pageId of pageIds) {
    const want = desiredByPage.get(pageId) ?? new Map<number, string>();
    const have = current.get(pageId) ?? new Map<number, string>();
    for (const id of have.keys()) if (!want.has(id)) stale.push({ pageId, logEventId: id });
    for (const [id, basis] of want) {
      if (!have.has(id)) added.push({ pageId, logEventId: id, source: 'auto', basis });
      else if (have.get(id) !== basis) rebased.push({ pageId, logEventId: id, basis });
    }
  }
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.pageLogEvent.deleteMany({ where: { OR: stale.slice(i, i + 500) } });
  }
  for (let i = 0; i < added.length; i += 1000) {
    await prisma.pageLogEvent.createMany({ data: added.slice(i, i + 1000), skipDuplicates: true });
  }
  for (const basis of ['declared', 'inferred']) {
    const list = rebased.filter((r) => r.basis === basis);
    for (let i = 0; i < list.length; i += 500) {
      await prisma.pageLogEvent.updateMany({
        where: { OR: list.slice(i, i + 500).map(({ pageId, logEventId }) => ({ pageId, logEventId })) },
        data: { basis },
      });
    }
  }
  return { added: added.length, removed: stale.length };
}

/** Replaces the AND groups of pages whose groups changed. */
async function applyGroups(groupsByPage: Map<number, string[][]>, pageIds: number[]) {
  const existing = await prisma.telemetryGroup.findMany({ where: { pageId: { in: pageIds } }, select: { pageId: true, keys: true } });
  const norm = (groups: unknown[]) => JSON.stringify(groups.map((g) => [...(g as string[])].sort()).sort());
  const current = new Map<number, unknown[]>();
  for (const g of existing) current.set(g.pageId, [...(current.get(g.pageId) ?? []), g.keys]);
  const changed = pageIds.filter((id) => norm(current.get(id) ?? []) !== norm(groupsByPage.get(id) ?? []));
  if (!changed.length) return;
  await prisma.telemetryGroup.deleteMany({ where: { pageId: { in: changed } } });
  const data = changed.flatMap((pageId) => (groupsByPage.get(pageId) ?? []).map((keys) => ({ pageId, keys: keys as Prisma.InputJsonValue })));
  for (let i = 0; i < data.length; i += 1000) await prisma.telemetryGroup.createMany({ data: data.slice(i, i + 1000) });
}

async function sync(pages: PageRow[]) {
  const byPage = new Map(pages.map((p) => [p.id, parsed(p)]));
  const ids = await ensureLogEvents(Array.from(byPage.values()).flatMap((x) => x.events));
  const desired = new Map(
    Array.from(byPage, ([pageId, { events }]) => [pageId, new Map(events.map((e) => [ids.get(logEventKey(e))!, e.basis]))] as const)
  );
  const result = await applyLinks(desired, pages.map((p) => p.id));
  await applyGroups(new Map(Array.from(byPage, ([pageId, { groups }]) => [pageId, groups])), pages.map((p) => p.id));
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
