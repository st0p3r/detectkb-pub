import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { LOG_SOURCES } from '../lib/log-events';
import { kbCache, kbCacheMap } from '../lib/kb-cache';
import { requirePermission } from '../middleware/auth';
import { createDataSourcePages, planDataSourcePages } from '../lib/data-source-pages';
import { loadRuleTelemetry, loadTelemetryInfo, sourceLabel } from '../lib/coverage-analysis';
import { feedSummary, keyState, loadCollection, missingKeys, opportunities, ruleFeed, techniqueName } from '../lib/collection';

// Telemetry other than Sysmon for Windows: log sources, their events, and the
// rules / data source pages that depend on each (links are derived from the
// rules, see lib/log-links.ts).

const router = Router();

interface EventRow {
  key: string;
  source: string;
  sourceLabel: string;
  code: string;
  name: string;
  rules: number;
  dataSources: number;
}

async function eventRows(where: { source?: string } = {}): Promise<EventRow[]> {
  const events = await prisma.logEvent.findMany({
    where,
    select: { id: true, key: true, source: true, sourceLabel: true, code: true, name: true },
  });
  const links = await prisma.pageLogEvent.findMany({
    where: { logEventId: { in: events.map((e) => e.id) } },
    select: { logEventId: true, page: { select: { type: true, rule: { select: { id: true } } } } },
  });
  const counts = new Map<number, { rules: number; dataSources: number }>();
  for (const l of links) {
    const c = counts.get(l.logEventId) ?? { rules: 0, dataSources: 0 };
    if (l.page.rule) c.rules++;
    else if (l.page.type === 'DATA_SOURCE') c.dataSources++;
    counts.set(l.logEventId, c);
  }
  return events.map(({ id, ...e }) => ({ ...e, ...(counts.get(id) ?? { rules: 0, dataSources: 0 }) }));
}

async function buildSources() {
  const [events, sysmonRules] = await Promise.all([
    eventRows(),
    prisma.detectionRule.count({ where: { page: { sysmonEvents: { some: {} } } } }),
  ]);
  const ruleSets = new Map<string, Set<number>>();
  const links = await prisma.pageLogEvent.findMany({
    where: { page: { rule: { isNot: null } } },
    select: { pageId: true, logEvent: { select: { source: true } } },
  });
  for (const l of links) {
    if (!ruleSets.has(l.logEvent.source)) ruleSets.set(l.logEvent.source, new Set());
    ruleSets.get(l.logEvent.source)!.add(l.pageId);
  }
  const bySource = new Map<string, { key: string; label: string; platform: string; events: number; rules: number }>();
  for (const e of events) {
    const entry = bySource.get(e.source) ?? {
      key: e.source,
      label: LOG_SOURCES[e.source]?.label ?? e.sourceLabel,
      platform: LOG_SOURCES[e.source]?.platform ?? (e.source.startsWith('windows-') ? 'Windows' : 'Other'),
      events: 0,
      rules: ruleSets.get(e.source)?.size ?? 0,
    };
    if (e.code !== '*') entry.events++;
    bySource.set(e.source, entry);
  }
  const sysmonEvents = await prisma.sysmonEvent.count({ where: { pages: { some: {} } } });
  return [
    { key: 'sysmon', label: 'Sysmon', platform: 'Windows', events: sysmonEvents, rules: sysmonRules },
    ...Array.from(bySource.values()).sort((a, b) => b.rules - a.rules || a.label.localeCompare(b.label)),
  ];
}

const eventsCache = kbCacheMap(
  async (source) =>
    (await eventRows({ source })).sort(
      (a, b) => Number(a.code !== '*') - Number(b.code !== '*') || b.rules - a.rules || a.code.localeCompare(b.code, 'en', { numeric: true })
    ),
  { label: 'log source events', maxKeys: 40 }
);

const sourcesCache = kbCache(buildSources, undefined, { warm: true, label: 'log sources' });

// GET /api/log-sources/data-source-pages — log sources rules read, and the data source pages covering each
router.get('/data-source-pages', async (_req, res) => {
  res.json(await planDataSourcePages());
});

// POST /api/log-sources/data-source-pages { sources } — create pages for sources without one
router.post('/data-source-pages', requirePermission('pages:create'), async (req, res) => {
  const sources = Array.isArray(req.body?.sources) ? req.body.sources.filter((s: unknown): s is string => typeof s === 'string') : [];
  if (!sources.length) {
    res.status(400).json({ error: 'Choose the log sources' });
    return;
  }
  res.json({ created: await createDataSourcePages(sources) });
});

// GET /api/log-sources — every log source with its event and rule counts,
// plus Sysmon for Windows (which has its own page)
router.get('/', async (_req, res) => {
  res.json(await sourcesCache.get());
});

// ── What is collected ───────────────────────────────────────────────────────

// GET /api/log-sources/collection — the answers given so far (per source or
// event) and what they mean for the rules
router.get('/collection', async (_req, res) => {
  const [entries, rules, map] = await Promise.all([
    prisma.telemetryCollection.findMany({ select: { key: true, collected: true, note: true, updatedAt: true }, orderBy: { key: 'asc' } }),
    loadRuleTelemetry(),
    loadCollection(),
  ]);
  res.json({ active: entries.length > 0, entries, rules: feedSummary(rules, map) });
});

const COLLECTION_KEY = /^[a-z0-9][a-z0-9_.-]*(:[^\s]{1,150})?$/i;

// PUT /api/log-sources/collection { items: [{ key, collected: true|false|null, note? }] }
// — null removes the answer (back to "not decided")
router.put('/collection', requirePermission('rules:update'), async (req, res) => {
  const items: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const valid = items.filter(
    (i): i is { key: string; collected: boolean | null; note?: string } =>
      !!i && typeof (i as { key?: unknown }).key === 'string' && COLLECTION_KEY.test((i as { key: string }).key) && [true, false, null].includes((i as { collected: boolean | null }).collected)
  );
  if (!valid.length || valid.length !== items.length || items.length > 2000) {
    res.status(400).json({ error: 'Send items: [{ key, collected: true | false | null }]' });
    return;
  }
  const userId = req.user?.userId ?? null;
  await prisma.$transaction(
    valid.map((i) => {
      if (i.collected === null) return prisma.telemetryCollection.deleteMany({ where: { key: i.key } });
      const note = typeof i.note === 'string' ? i.note.trim().slice(0, 500) || null : undefined;
      return prisma.telemetryCollection.upsert({
        where: { key: i.key },
        create: { key: i.key, collected: i.collected, note: note ?? null, updatedById: userId },
        update: { collected: i.collected, ...(note !== undefined && { note }), updatedById: userId },
      });
    })
  );
  await prisma.auditLog.create({
    data: { userId, action: 'COLLECTION_UPDATE', resourceType: 'log-source', newValue: { items: valid.slice(0, 50).map((i) => ({ key: i.key, collected: i.collected })), count: valid.length } },
  });
  res.json({ updated: valid.length });
});

// GET /api/log-sources/collection/opportunities — draft rules whose logs are
// already collected, and the sources worth collecting next
router.get('/collection/opportunities', async (_req, res) => {
  const [rules, map, info] = await Promise.all([loadRuleTelemetry(), loadCollection(), loadTelemetryInfo()]);
  const { ready, sources } = opportunities(rules, map);
  const named = (ids: string[]) => ids.map((id) => ({ id, name: techniqueName(id) }));
  res.json({
    active: map.size > 0,
    readyTotal: ready.length,
    readyFillingGaps: ready.filter((r) => r.fills.length).length,
    ready: ready.slice(0, 200).map((r) => ({ ...r, fills: named(r.fills) })),
    sources: sources.map((s) => ({ ...s, label: sourceLabel(s.source, info), techniqueCount: s.techniques.length, techniques: named(s.techniques.slice(0, 40)) })),
  });
});

// GET /api/log-sources/collection/rule/:pageId — is this rule fed by what is collected?
router.get('/collection/rule/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const [rules, map, info] = await Promise.all([loadRuleTelemetry(), loadCollection(), loadTelemetryInfo()]);
  const rule = rules.find((r) => r.pageId === pageId);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  res.json({
    active: map.size > 0,
    feed: ruleFeed(rule, map),
    telemetry: rule.telemetry.map((key) => ({ key, label: info.get(key)?.label ?? key, state: keyState(map, key) })),
    missing: missingKeys(rule, map).map((key) => info.get(key)?.label ?? key),
  });
});

// GET /api/log-sources/:source/events — a source's events with rule counts
router.get('/:source/events', async (req, res) => {
  res.json(await eventsCache.get(req.params.source));
});


// GET /api/log-sources/events/pages?key=windows-security:4688 — rules and data sources using an event
router.get('/events/pages', async (req, res) => {
  const key = String(req.query.key ?? '');
  const event = await prisma.logEvent.findUnique({ where: { key }, select: { id: true } });
  if (!event) {
    res.status(404).json({ error: 'Unknown log event' });
    return;
  }
  const links = await prisma.pageLogEvent.findMany({
    where: { logEventId: event.id },
    select: {
      source: true,
      basis: true,
      page: { select: { id: true, title: true, slug: true, type: true, rule: { select: { status: true, severity: true } } } },
    },
    orderBy: { page: { title: 'asc' } },
  });
  const linked = links.map(({ source, basis, page: { rule, ...page } }) => ({
    ...page,
    source,
    basis,
    status: rule?.status ?? null,
    severity: rule?.severity ?? null,
    isRule: !!rule,
  }));
  res.json({
    rules: linked.filter((p) => p.isRule),
    dataSources: linked.filter((p) => !p.isRule),
  });
});

// GET /api/log-sources/page/:pageId — a page's log events (rule and data source pages)
router.get('/page/:pageId', async (req, res) => {
  const links = await prisma.pageLogEvent.findMany({
    where: { pageId: Number(req.params.pageId) },
    select: { logEvent: { select: { key: true, source: true, sourceLabel: true, code: true, name: true } } },
    orderBy: { logEvent: { key: 'asc' } },
  });
  res.json(links.map((l) => l.logEvent));
});

export default router;
