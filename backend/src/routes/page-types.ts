import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

// GET /api/page-types — list all page types (public)
router.get('/', async (_req, res) => {
  const types = await prisma.pageTypeDefinition.findMany({
    orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
  });
  res.json(types);
});

// POST /api/page-types — create a custom page type (auth required)
router.post('/', authMiddleware, async (req, res) => {
  const { name, label, color = '#6366f1' } = req.body as {
    name?: string;
    label?: string;
    color?: string;
  };

  if (!name || !label) {
    res.status(400).json({ error: 'name and label are required' });
    return;
  }

  const nameUpper = name.toUpperCase().replace(/\s+/g, '_');
  if (!/^[A-Z0-9_]+$/.test(nameUpper)) {
    res.status(400).json({ error: 'name must contain only letters, numbers, and underscores' });
    return;
  }

  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    res.status(400).json({ error: 'color must be a valid hex color (e.g. #6366f1)' });
    return;
  }

  const existing = await prisma.pageTypeDefinition.findUnique({ where: { name: nameUpper } });
  if (existing) {
    res.status(409).json({ error: 'A page type with that name already exists' });
    return;
  }

  const type = await prisma.pageTypeDefinition.create({
    data: { name: nameUpper, label, color, isBuiltIn: false },
  });

  res.status(201).json(type);
});

// DELETE /api/page-types/:name — delete a custom page type (auth required)
router.delete('/:name', authMiddleware, async (req, res) => {
  const name = req.params.name.toUpperCase();

  const type = await prisma.pageTypeDefinition.findUnique({ where: { name } });
  if (!type) {
    res.status(404).json({ error: 'Page type not found' });
    return;
  }

  if (type.isBuiltIn) {
    res.status(403).json({ error: 'Cannot delete built-in page types' });
    return;
  }

  await prisma.pageTypeDefinition.delete({ where: { name } });
  res.json({ message: 'Page type deleted' });
});

export default router;
