import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const prisma = new PrismaClient();
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
  res.json(events);
});

// POST /api/sysmon-events — create custom event (auth required)
router.post('/', authMiddleware, async (req, res) => {
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
router.put('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const { detectionTips, attackPatterns, keyFields, description, detectionValue } = req.body;
  const event = await prisma.sysmonEvent.update({
    where: { id },
    data: { detectionTips, attackPatterns, keyFields, description, detectionValue },
  });
  res.json(event);
});

// DELETE /api/sysmon-events/:id — delete custom event (auth required, cannot delete built-in)
router.delete('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const event = await prisma.sysmonEvent.findUnique({ where: { id } });
  if (!event) { res.status(404).json({ error: 'Event not found' }); return; }
  if (event.isBuiltIn) { res.status(403).json({ error: 'Cannot delete built-in Sysmon events' }); return; }
  await prisma.sysmonEvent.delete({ where: { id } });
  res.json({ message: 'Deleted' });
});

export default router;
