import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { LOG_SOURCES } from '../lib/log-events';

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

// GET /api/log-sources — every log source with its event and rule counts,
// plus Sysmon for Windows (which has its own page)
router.get('/', async (_req, res) => {
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
  res.json([
    { key: 'sysmon', label: 'Sysmon', platform: 'Windows', events: sysmonEvents, rules: sysmonRules },
    ...Array.from(bySource.values()).sort((a, b) => b.rules - a.rules || a.label.localeCompare(b.label)),
  ]);
});

// GET /api/log-sources/:source/events — a source's events with rule counts
router.get('/:source/events', async (req, res) => {
  const rows = await eventRows({ source: req.params.source });
  res.json(rows.sort((a, b) => Number(a.code !== '*') - Number(b.code !== '*') || b.rules - a.rules || a.code.localeCompare(b.code, 'en', { numeric: true })));
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
