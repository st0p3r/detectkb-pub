import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  res.json(categories);
});

router.post('/', async (req, res) => {
  const { name, color, parentId } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const category = await prisma.category.create({
    data: { name, color: color || null, parentId: parentId || null },
  });
  res.status(201).json(category);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, color, parentId } = req.body;

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(color !== undefined && { color }),
      ...(parentId !== undefined && { parentId: parentId || null }),
    },
  });
  res.json(category);
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  await prisma.category.delete({ where: { id } });
  res.status(204).send();
});

export default router;
