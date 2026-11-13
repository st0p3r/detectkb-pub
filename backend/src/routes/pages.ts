import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveWikiLinks } from '../lib/links';
import { isAdmin } from '../middleware/auth';
import { SaveError, getRevision, listRevisions, restoreRevision, savePage } from '../lib/page-save';

const router = Router();

const PAGE_INCLUDE = {
  tags: { include: { tag: true } },
  category: true,
  rule: { include: { owner: { select: { id: true, username: true } } } },
  splCommand: true,
  sysmonEvents: {
    select: { source: true, basis: true, sysmonEvent: { select: { id: true, eventId: true, name: true, category: true } } },
    orderBy: { sysmonEvent: { eventId: 'asc' as const } },
  },
  logEvents: {
    select: { basis: true, logEvent: { select: { key: true, source: true, sourceLabel: true, code: true, name: true } } },
    orderBy: { logEvent: { key: 'asc' as const } },
  },
  stories: { select: { story: { select: { id: true, name: true } } }, orderBy: { story: { name: 'asc' as const } } },
  // The fields the rule's detection reads (lib/query-fields)
  fields: { select: { field: true, source: true }, orderBy: { field: 'asc' as const } },
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
  let page = await prisma.page.findUnique({
    where: { slug: req.params.slug },
    include: PAGE_INCLUDE,
  });
  // A renamed page: its old address still opens it (the response carries the new slug)
  if (!page) {
    const alias = await prisma.pageSlugAlias.findUnique({ where: { slug: req.params.slug }, select: { pageId: true } });
    if (alias) page = await prisma.page.findUnique({ where: { id: alias.pageId }, include: PAGE_INCLUDE });
  }

  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json({ ...page, wikiLinks: await resolveWikiLinks(page.contentMd) });
});

const can = (req: Request, permission: string) => !!req.user && (isAdmin(req.user) || req.user.permissions.includes(permission));

/**
 * Saves a page from a request body: the page's own fields and, when sent,
 * `rule`, `splCommand` and `sysmonEventIds` — all or nothing (lib/page-save).
 * `expectedUpdatedAt` refuses the save (409) when someone else saved since.
 */
async function saveFromRequest(req: Request, res: Response, id?: number) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const rule = obj(body.rule);
  if (rule && !can(req, id ? 'rules:update' : 'rules:create')) {
    res.status(403).json({ error: 'Forbidden: you may not change detection rules' });
    return;
  }
  try {
    const pageId = await savePage(
      {
        id,
        title: body.title === undefined ? undefined : String(body.title ?? ''),
        contentMd: body.contentMd === undefined ? undefined : String(body.contentMd ?? ''),
        type: body.type === undefined ? undefined : String(body.type),
        categoryId: body.categoryId === undefined ? undefined : Number(body.categoryId) || null,
        isPinned: body.isPinned === undefined ? undefined : Boolean(body.isPinned),
        tagNames: body.tagNames === undefined ? undefined : Array.isArray(body.tagNames) ? body.tagNames.map(String) : [],
        rule,
        splCommand: obj(body.splCommand),
        sysmonEventIds: Array.isArray(body.sysmonEventIds) ? (body.sysmonEventIds as number[]) : undefined,
        expectedUpdatedAt: typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined,
        force: body.force === true,
      },
      req.user ? { userId: req.user.userId, username: req.user.username } : null
    );
    const page = await prisma.page.findUnique({ where: { id: pageId }, include: PAGE_INCLUDE });
    res.status(id ? 200 : 201).json(page);
  } catch (err) {
    if (err instanceof SaveError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    throw err;
  }
}

router.post('/', (req, res) => saveFromRequest(req, res));

router.put('/:id', (req, res) => saveFromRequest(req, res, Number(req.params.id)));

// GET /api/pages/:id/revisions — the page's versions, newest first
router.get('/:id/revisions', async (req, res) => {
  res.json(await listRevisions(Number(req.params.id)));
});

// GET /api/pages/:id/revisions/:revisionId — one version, and the one before it
router.get('/:id/revisions/:revisionId', async (req, res) => {
  const revision = await getRevision(Number(req.params.id), Number(req.params.revisionId));
  if (!revision) return res.status(404).json({ error: 'Version not found' });
  res.json(revision);
});

// PUT /api/pages/:id/revisions/:revisionId/restore — make that version the page again
router.put('/:id/revisions/:revisionId/restore', async (req, res) => {
  const pageId = Number(req.params.id);
  if ((await prisma.detectionRule.findUnique({ where: { pageId }, select: { id: true } })) && !can(req, 'rules:update')) {
    return res.status(403).json({ error: 'Forbidden: you may not change detection rules' });
  }
  try {
    await restoreRevision(pageId, Number(req.params.revisionId), req.user ? { userId: req.user.userId, username: req.user.username } : null);
  } catch (err) {
    if (err instanceof SaveError) return res.status(err.status).json({ error: err.message, ...err.extra });
    throw err;
  }
  res.json(await prisma.page.findUnique({ where: { id: pageId }, include: PAGE_INCLUDE }));
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

export default router;
