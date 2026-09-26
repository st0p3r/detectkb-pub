import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { generateUniqueSlug } from '../lib/slug';
import { syncPageLinks } from '../lib/links';
import { syncAutoSysmonLinks } from '../lib/sysmon-links';

const router = Router();

const PAGE_INCLUDE = {
  tags: { include: { tag: true } },
  category: true,
  rule: true,
  splCommand: true,
  sysmonEvents: {
    select: { source: true, sysmonEvent: { select: { id: true, eventId: true, name: true, category: true } } },
    orderBy: { sysmonEvent: { eventId: 'asc' as const } },
  },
};

router.get('/', async (req, res) => {
  const { type, categoryId, q } = req.query;

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (categoryId) where.categoryId = Number(categoryId);
  if (q) {
    where.OR = [
      { title: { contains: String(q) } },
      { contentMd: { contains: String(q) } },
    ];
  }

  const pages = await prisma.page.findMany({
    where,
    include: PAGE_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });

  res.json(pages);
});

router.get('/:slug', async (req, res) => {
  const page = await prisma.page.findUnique({
    where: { slug: req.params.slug },
    include: PAGE_INCLUDE,
  });

  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json(page);
});

router.post('/', async (req, res) => {
  const { title, contentMd = '', type = 'NOTE', categoryId, isPinned = false, tagNames = [] } = req.body;

  if (!title) return res.status(400).json({ error: 'title is required' });

  const slug = await generateUniqueSlug(title);

  const page = await prisma.page.create({
    data: {
      title,
      slug,
      contentMd,
      type,
      categoryId: categoryId || null,
      isPinned,
      tags: {
        create: await buildTagConnections(tagNames),
      },
    },
    include: PAGE_INCLUDE,
  });

  await syncPageLinks(page.id, contentMd);
  await syncAutoSysmonLinks(page.id);

  res.status(201).json(page);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { title, contentMd, type, categoryId, isPinned, tagNames } = req.body;

  const existing = await prisma.page.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Page not found' });

  const slug = title && title !== existing.title
    ? await generateUniqueSlug(title, id)
    : existing.slug;

  if (tagNames !== undefined) {
    await prisma.tagsOnPages.deleteMany({ where: { pageId: id } });
  }

  const page = await prisma.page.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      slug,
      ...(contentMd !== undefined && { contentMd }),
      ...(type !== undefined && { type }),
      ...(categoryId !== undefined && { categoryId: categoryId || null }),
      ...(isPinned !== undefined && { isPinned }),
      ...(tagNames !== undefined && {
        tags: { create: await buildTagConnections(tagNames) },
      }),
    },
    include: PAGE_INCLUDE,
  });

  await syncPageLinks(id, contentMd ?? existing.contentMd);
  await syncAutoSysmonLinks(id);
  if (tagNames !== undefined) await pruneOrphanedTags();

  res.json(page);
});

router.get('/:slug/backlinks', async (req, res) => {
  const page = await prisma.page.findUnique({ where: { slug: req.params.slug } });
  if (!page) return res.status(404).json({ error: 'Not found' });
  const backlinks = await prisma.pageLink.findMany({
    where: { targetId: page.id },
    include: { source: { select: { id: true, title: true, slug: true, type: true } } },
  });
  res.json(backlinks.map((l) => l.source));
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.page.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Page not found' });

  await prisma.page.delete({ where: { id } });
  await pruneOrphanedTags();
  res.status(204).send();
});

async function pruneOrphanedTags() {
  await prisma.tag.deleteMany({
    where: { pages: { none: {} } },
  });
}

async function buildTagConnections(tagNames: string[]) {
  const names: string[] = Array.isArray(tagNames)
    ? tagNames.map((n) => n.trim()).filter(Boolean)
    : [];

  return Promise.all(
    names.map(async (name) => {
      const tag = await prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      return { tagId: tag.id };
    })
  );
}

export default router;
