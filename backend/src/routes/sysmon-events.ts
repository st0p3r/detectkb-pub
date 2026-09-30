import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { setManualSysmonLinks } from '../lib/sysmon-links';

const router = Router();

// GET /api/sysmon-events — list with optional ?category= and ?q= filters
router.get('/', async (req, res) => {
  const { category, q } = req.query as { category?: string; q?: string };
  const events = await prisma.sysmonEvent.findMany({
    where: {
      ...(category ? { category } : {}),
      ...(q ? {
        OR: [
          { name: { contains: q } },
          { description: { contains: q } },
          { attackPatterns: { contains: q } },
          { detectionTips: { contains: q } },
        ],
      } : {}),
    },
    orderBy: { eventId: 'asc' },
  });

  // Counts only: the linked pages load per event (GET /:eventId/pages);
  // with every rule inlined this list was ~250 KB
  const links = await prisma.pageSysmonEvent.findMany({
    where: { sysmonEventId: { in: events.map((e) => e.id) } },
    select: { sysmonEventId: true, page: { select: { type: true, rule: { select: { id: true } } } } },
  });
  const counts = new Map<number, { ruleCount: number; dataSourceCount: number; otherPageCount: number }>();
  for (const { sysmonEventId, page } of links) {
    const c = counts.get(sysmonEventId) ?? { ruleCount: 0, dataSourceCount: 0, otherPageCount: 0 };
    if (page.rule) c.ruleCount++;
    else if (page.type === 'DATA_SOURCE') c.dataSourceCount++;
    else c.otherPageCount++;
    counts.set(sysmonEventId, c);
  }
  res.json(events.map((e) => ({ ...e, ...(counts.get(e.id) ?? { ruleCount: 0, dataSourceCount: 0, otherPageCount: 0 }) })));
});

// GET /api/sysmon-events/10/pages — pages linked to an event (by Sysmon event ID),
// split into rules / data sources / other pages
router.get('/:eventId/pages', async (req, res) => {
  const eventId = Number(req.params.eventId);
  const event = Number.isInteger(eventId) ? await prisma.sysmonEvent.findUnique({ where: { eventId } }) : null;
  if (!event) {
    res.status(404).json({ error: 'Unknown Sysmon event' });
    return;
  }
  const pages = await prisma.pageSysmonEvent.findMany({
    where: { sysmonEventId: event.id },
    select: {
      source: true,
      basis: true,
      page: { select: { id: true, title: true, slug: true, type: true, rule: { select: { status: true, severity: true } } } },
    },
    orderBy: { page: { title: 'asc' } },
  });
  const linked = pages.map(({ source, basis, page: { rule, ...page } }) => ({
    ...page,
    source,
    basis,
    status: rule?.status ?? null,
    severity: rule?.severity ?? null,
    isRule: !!rule,
  }));
  res.json({
    rules: linked.filter((p) => p.isRule),
    dataSources: linked.filter((p) => !p.isRule && p.type === 'DATA_SOURCE'),
    otherPages: linked.filter((p) => !p.isRule && p.type !== 'DATA_SOURCE'),
  });
});

// PUT /api/sysmon-events/links/:pageId — { eventIds: [1, 10] } sets a page's manual links
router.put('/links/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const { eventIds } = req.body as { eventIds?: unknown };
  if (isNaN(pageId) || !Array.isArray(eventIds) || !eventIds.every((n) => Number.isInteger(n))) {
    res.status(400).json({ error: 'pageId and eventIds (array of integers) are required' });
    return;
  }
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }
  await setManualSysmonLinks(pageId, eventIds as number[]);
  const links = await prisma.pageSysmonEvent.findMany({
    where: { pageId },
    select: { source: true, sysmonEvent: { select: { id: true, eventId: true, name: true, category: true } } },
    orderBy: { sysmonEvent: { eventId: 'asc' } },
  });
  res.json(links);
});

// POST /api/sysmon-events — create custom event (auth required)
router.post('/', async (req, res) => {
  const { eventId, name, category, description, keyFields, detectionTips, attackPatterns, detectionValue } = req.body;
  if (!eventId || !name || !category || !description) {
    res.status(400).json({ error: 'eventId, name, category, and description are required' });
    return;
  }
  const existing = await prisma.sysmonEvent.findUnique({ where: { eventId: Number(eventId) } });
  if (existing) {
    res.status(409).json({ error: 'An event with that ID already exists' });
    return;
  }
  const event = await prisma.sysmonEvent.create({
    data: { eventId: Number(eventId), name, category, description, keyFields, detectionTips, attackPatterns, detectionValue: detectionValue || 'medium', isBuiltIn: false },
  });
  res.status(201).json(event);
});

// PUT /api/sysmon-events/:id — update event (auth required)
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { detectionTips, attackPatterns, keyFields, description, detectionValue } = req.body;
  const event = await prisma.sysmonEvent.update({
    where: { id },
    data: { detectionTips, attackPatterns, keyFields, description, detectionValue },
  });
  res.json(event);
});

// DELETE /api/sysmon-events/:id — delete custom event (auth required, cannot delete built-in)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const event = await prisma.sysmonEvent.findUnique({ where: { id } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  if (event.isBuiltIn) { res.status(403).json({ error: 'Cannot delete built-in Sysmon events' }); return; }
  await prisma.sysmonEvent.delete({ where: { id } });
  res.json({ message: 'Deleted' });
});

export default router;
