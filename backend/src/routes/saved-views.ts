import { Router } from 'express';
import { prisma } from '../lib/prisma';

// A user's saved list views (sidebar shortcuts). Each user sees only their own.

const router = Router();

/** Pages whose state lives in the URL and can be saved. */
export const SAVABLE_PATHS = ['/rules', '/pages', '/graph'];
const MAX_VIEWS = 50;

/** The query string to save: without the page number or an open preview. */
export function cleanViewQuery(raw: string) {
  const params = new URLSearchParams(raw.replace(/^\?/, ''));
  params.delete('page');
  params.delete('preview');
  return params.toString();
}

router.get('/', async (req, res) => {
  const views = await prisma.savedView.findMany({
    where: { userId: req.user!.userId },
    select: { id: true, name: true, path: true, query: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(views);
});

// POST /api/saved-views { name, path, query }
router.post('/', async (req, res) => {
  const userId = req.user!.userId;
  if (!userId) {
    res.status(403).json({ error: 'Saved views need a user account' });
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const path = String(req.body?.path ?? '');
  const query = cleanViewQuery(String(req.body?.query ?? ''));
  if (!name || name.length > 80) {
    res.status(400).json({ error: 'Name must be 1–80 characters' });
    return;
  }
  if (!SAVABLE_PATHS.includes(path)) {
    res.status(400).json({ error: `Views can be saved for ${SAVABLE_PATHS.join(', ')}` });
    return;
  }
  if (query.length > 1000) {
    res.status(400).json({ error: 'Too many filters to save' });
    return;
  }
  if ((await prisma.savedView.count({ where: { userId } })) >= MAX_VIEWS) {
    res.status(400).json({ error: `At most ${MAX_VIEWS} saved views` });
    return;
  }
  const view = await prisma.savedView.create({ data: { userId, name, path, query }, select: { id: true, name: true, path: true, query: true } });
  res.status(201).json(view);
});

router.delete('/:id', async (req, res) => {
  const { count } = await prisma.savedView.deleteMany({ where: { id: Number(req.params.id), userId: req.user!.userId } });
  if (!count) {
    res.status(404).json({ error: 'View not found' });
    return;
  }
  res.status(204).send();
});

export default router;
