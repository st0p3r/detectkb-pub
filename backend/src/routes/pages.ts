import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateUniqueSlug } from '../lib/slug';
import { resolveWikiLinks, syncPageLinks } from '../lib/links';
import { syncDerivedLinks } from '../lib/derived-links';

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
  logEvents: {
    select: { logEvent: { select: { key: true, source: true, sourceLabel: true, code: true, name: true } } },
    orderBy: { logEvent: { key: 'asc' as const } },
  },
  stories: { select: { story: { select: { id: true, name: true } } }, orderBy: { story: { name: 'asc' as const } } },
};

// What page lists show: no markdown, queries or imported source files (those
// made the full list tens of MB). GET /api/pages/:slug has everything.
const PAGE_LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  type: true,
  isPinned: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  tags: { include: { tag: true } },
  category: true,
  rule: { select: { status: true, severity: true } },
};

const PAGE_SORTS = ['title', 'type', 'updatedAt'] as const;
type PageSort = (typeof PAGE_SORTS)[number];

// GET /api/pages?type=&categoryId=&tag=&q= — every matching page (list columns).
// With page= it is paged and sorted (sort=title|type|updatedAt, dir=, pageSize=)
// and returns { items, total, page, pageSize, typeCounts }.
/**
 * Filters of the page list: type, excludeType (e.g. RULE), categoryId, tag, q.
 * `base` leaves the type out, for the type chip counts.
 */
function pageFilters(query: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const type = str(query.type);
  const excludeType = str(query.excludeType);
  const q = str(query.q);
  const tag = str(query.tag);
  const categoryId = Number(query.categoryId) || undefined;

  const base: Prisma.PageWhereInput[] = [];
  if (categoryId) base.push({ categoryId });
  if (tag) base.push({ tags: { some: { tag: { name: tag } } } });
  if (q) base.push({ OR: [{ title: { contains: q } }, { contentMd: { contains: q } }] });
  const types: Prisma.PageWhereInput[] = [];
  if (type) types.push({ type });
  if (excludeType) types.push({ type: { notIn: excludeType.split(',') } });
  return { base, where: { AND: [...base, ...types] } as Prisma.PageWhereInput };
}

router.get('/', async (req, res) => {
  const { base, where } = pageFilters(req.query);

  if (req.query.page === undefined) {
    res.json(await prisma.page.findMany({ where, select: PAGE_LIST_SELECT, orderBy: { updatedAt: 'desc' } }));
    return;
  }

  const sort: PageSort = PAGE_SORTS.includes(req.query.sort as PageSort) ? (req.query.sort as PageSort) : 'updatedAt';
  const dir = req.query.dir === 'asc' || req.query.dir === 'desc' ? req.query.dir : sort === 'updatedAt' ? 'desc' : 'asc';
  const pageSize = Math.min(Math.max(Math.floor(Number(req.query.pageSize)) || 50, 1), 200);

  const [total, byType] = await Promise.all([
    prisma.page.count({ where }),
    prisma.page.groupBy({ by: ['type'], where: { AND: base }, _count: { _all: true } }),
  ]);
  const page = Math.min(Math.max(Math.floor(Number(req.query.page)) || 1, 1), Math.max(1, Math.ceil(total / pageSize)));
  const orderBy: Prisma.PageOrderByWithRelationInput[] = [{ [sort]: dir }, ...(sort === 'updatedAt' ? [] : [{ updatedAt: 'desc' as const }]), { id: 'asc' }];
  const items = await prisma.page.findMany({ where, select: PAGE_LIST_SELECT, orderBy, skip: (page - 1) * pageSize, take: pageSize });

  res.json({ items, total, page, pageSize, typeCounts: Object.fromEntries(byType.map((g) => [g.type, g._count._all])) });
});

// GET /api/pages/ids?<list filters> — ids of every matching page ("select all")
router.get('/ids', async (req, res) => {
  const pages = await prisma.page.findMany({ where: pageFilters(req.query).where, select: { id: true }, orderBy: { id: 'asc' } });
  res.json(pages.map((p) => p.id));
});

// GET /api/pages/titles?q=lsass&limit=10 — titles for [[wiki link]] autocomplete,
// titles starting with q first
router.get('/titles', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const select = { title: true, slug: true, type: true };
  const prefix = await prisma.page.findMany({ where: { title: { startsWith: q } }, select, orderBy: { title: 'asc' }, take: limit });
  const rest =
    q && prefix.length < limit
      ? await prisma.page.findMany({
          where: { title: { contains: q }, NOT: { title: { startsWith: q } } },
          select,
          orderBy: { title: 'asc' },
          take: limit - prefix.length,
        })
      : [];
  res.json([...prefix, ...rest]);
});

router.get('/:slug', async (req, res) => {
  const page = await prisma.page.findUnique({
    where: { slug: req.params.slug },
    include: PAGE_INCLUDE,
  });

  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json({ ...page, wikiLinks: await resolveWikiLinks(page.contentMd) });
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
  await syncDerivedLinks(page.id);

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
  await syncDerivedLinks(id);
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
