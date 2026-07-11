import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/tags — list tags with page counts (public)
router.get('/', async (req, res) => {
  const all = Boolean(req.query.all);
  const category = req.query.category as string | undefined;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  const tags = await prisma.tag.findMany({
    where,
    include: { _count: { select: { pages: true } } },
    orderBy: { name: 'asc' },
  });

  const result = all ? tags : tags.filter((t) => t._count.pages > 0);
  res.json(result);
});

// POST /api/tags — create a tag (auth required)
router.post('/', authMiddleware, async (req, res) => {
  const { name, color, description, category } = req.body as {
    name?: string;
    color?: string;
    description?: string;
    category?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const colorVal = color || '#3B82F6';
  if (!/^#[0-9A-Fa-f]{6}$/.test(colorVal)) {
    res.status(400).json({ error: 'color must be a valid hex color (e.g. #3B82F6)' });
    return;
  }

  const existing = await prisma.tag.findUnique({ where: { name: name.trim() } });
  if (existing) {
    res.status(409).json({ error: 'Tag with this name already exists' });
    return;
  }

  const tag = await prisma.tag.create({
    data: {
      name: name.trim(),
      color: colorVal,
      description: description?.trim() || null,
      category: category?.trim() || null,
    },
  });

  res.status(201).json(tag);
});

// PUT /api/tags/:id — update tag (auth required)
router.put('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, color, description, category } = req.body as {
    name?: string;
    color?: string;
    description?: string;
    category?: string;
  };

  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    res.status(400).json({ error: 'color must be a valid hex color (e.g. #3B82F6)' });
    return;
  }

  const tag = await prisma.tag.update({
    where: { id },
    data: {
      name: name?.trim() ?? undefined,
      color: color ?? undefined,
      description: description?.trim() ?? undefined,
      category: category?.trim() ?? undefined,
    },
  });

  res.json(tag);
});

// DELETE /api/tags/:id — delete tag (auth required)
router.delete('/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  await prisma.tag.delete({ where: { id } });
  res.json({ message: 'Tag deleted' });
});

// GET /api/tags/:name/pages — list pages for a tag
router.get('/:name/pages', async (req, res) => {
  const name = req.params.name;
  const tag = await prisma.tag.findUnique({
    where: { name },
    include: {
      pages: {
        include: {
          page: {
            select: { id: true, title: true, slug: true, type: true, updatedAt: true },
          },
        },
      },
    },
  });
  if (!tag) {
    res.status(404).json({ error: 'Tag not found' });
    return;
  }
  res.json(tag.pages.map((tp) => tp.page));
});

export default router;
