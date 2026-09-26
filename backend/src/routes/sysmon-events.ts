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
    include: {
      pages: {
        select: {
          source: true,
          page: {
            select: {
              id: true,
              title: true,
              slug: true,
              type: true,
              rule: { select: { status: true, severity: true } },
            },
          },
        },
        orderBy: { page: { title: 'asc' } },
      },
    },
  });

  // Split linked pages into rules / data sources / other for the UI
  res.json(
    events.map(({ pages, ...event }) => {
      const linked = pages.map(({ source, page: { rule, ...page } }) => ({
        ...page,
        source,
        status: rule?.status ?? null,
        severity: rule?.severity ?? null,
        isRule: !!rule,
      }));
      return {
        ...event,
        rules: linked.filter((p) => p.isRule),
        dataSources: linked.filter((p) => !p.isRule && p.type === 'DATA_SOURCE'),
        otherPages: linked.filter((p) => !p.isRule && p.type !== 'DATA_SOURCE'),
      };
    })
  );
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
