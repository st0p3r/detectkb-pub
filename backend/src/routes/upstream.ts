import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { parseRuleFile } from '../lib/rule-import';
import { AUTO_CHECK_DAYS, UPSTREAM_SOURCES, checkFiles, checkSource, dismissalKey, isRunning, sourceDef, sourceEnabled } from '../lib/upstream';
import { runImport } from './rule-import';

// Upstream updates: new and changed rules in the repositories rules were
// imported from. Checking only records what differs; importing is a choice.

const router = Router();
const canImport = requirePermission('rules:create');

// GET /api/upstream — the sources, their last check and how many items each has
router.get('/', async (_req, res) => {
  const [rows, counts] = await Promise.all([
    prisma.upstreamSource.findMany(),
    prisma.upstreamItem.groupBy({ by: ['sourceKey', 'kind', 'relevant'], _count: { _all: true } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const sources = await Promise.all(
    UPSTREAM_SOURCES.map(async (def) => {
      const row = byKey.get(def.key) ?? null;
      const count = (kind: string, relevant?: boolean) =>
        counts.filter((c) => c.sourceKey === def.key && c.kind === kind && (relevant === undefined || c.relevant === relevant)).reduce((n, c) => n + c._count._all, 0);
      return {
        key: def.key,
        label: def.label,
        format: def.format,
        repository: def.repository ?? null,
        downloadable: !!def.url,
        options: def.options ?? [],
        option: row?.option ?? def.options?.[0]?.value ?? null,
        enabled: await sourceEnabled(def, row),
        running: isRunning(def.key),
        lastCheckedAt: row?.lastCheckedAt ?? null,
        lastError: row?.lastError ?? null,
        stats: row?.stats ?? null,
        items: { new: count('new'), relevantNew: count('new', true), changed: count('changed') },
      };
    })
  );
  res.json({ autoCheckDays: AUTO_CHECK_DAYS, sources });
});

// GET /api/upstream/items?source=&kind=new|changed&relevant=1&q=&page=
router.get('/items', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const where: Prisma.UpstreamItemWhereInput = {
    ...(req.query.source ? { sourceKey: String(req.query.source) } : {}),
    ...(req.query.kind ? { kind: String(req.query.kind) } : {}),
    ...(req.query.relevant === '1' ? { relevant: true } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { techniques: { contains: q } }, { path: { contains: q } }] } : {}),
  };
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 100;
  const [total, items] = await Promise.all([
    prisma.upstreamItem.count({ where }),
    prisma.upstreamItem.findMany({
      where,
      select: {
        id: true,
        sourceKey: true,
        kind: true,
        format: true,
        externalId: true,
        title: true,
        path: true,
        pageId: true,
        changes: true,
        severity: true,
        sourceStatus: true,
        techniques: true,
        telemetry: true,
        relevant: true,
        checkedAt: true,
      },
      orderBy: [{ relevant: 'desc' }, { title: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const pages = await prisma.page.findMany({
    where: { id: { in: items.map((i) => i.pageId).filter((x): x is number => x !== null) } },
    select: { id: true, title: true, slug: true, rule: { select: { status: true } } },
  });
  const pageById = new Map(pages.map((p) => [p.id, p]));
  res.json({
    total,
    page,
    pageSize,
    items: items.map((i) => {
      const p = i.pageId ? pageById.get(i.pageId) : undefined;
      return { ...i, existing: p ? { title: p.title, slug: p.slug, status: p.rule?.status ?? null } : null };
    }),
  });
});

// GET /api/upstream/items/:id/content — the upstream file
router.get('/items/:id/content', async (req, res) => {
  const item = await prisma.upstreamItem.findUnique({ where: { id: Number(req.params.id) }, select: { path: true, content: true } });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(item);
});

// POST /api/upstream/check { source } — download and compare (runs in the background)
router.post('/check', canImport, async (req, res) => {
  const key = String(req.body?.source ?? '');
  const def = sourceDef(key);
  if (!def?.url) {
    res.status(400).json({ error: 'Unknown or upload-only source' });
    return;
  }
  if (isRunning(key)) {
    res.status(409).json({ error: 'A check of this source is already running' });
    return;
  }
  checkSource(key).catch((err) => console.warn(`[upstream] ${key}: ${(err as Error).message}`));
  res.status(202).json({ started: true });
});

// POST /api/upstream/check-upload { files: [{ name, content }] } — compare uploaded rule files (offline servers)
router.post('/check-upload', canImport, async (req, res) => {
  const files = (Array.isArray(req.body?.files) ? req.body.files : []) as { name?: unknown; content?: unknown }[];
  const valid = files
    .filter((f) => typeof f.name === 'string' && typeof f.content === 'string')
    .map((f) => ({ path: String(f.name).slice(0, 500), content: String(f.content) }));
  if (!valid.length) {
    res.status(400).json({ error: 'No files' });
    return;
  }
  res.json(await checkFiles('upload', valid));
});

// PUT /api/upstream/sources/:key { enabled?, option? }
router.put('/sources/:key', requirePermission('settings:manage'), async (req, res) => {
  const def = sourceDef(req.params.key);
  if (!def) {
    res.status(404).json({ error: 'Unknown source' });
    return;
  }
  const data: Prisma.UpstreamSourceUpdateInput = {};
  if (typeof req.body?.enabled === 'boolean') data.enabled = req.body.enabled;
  if (typeof req.body?.option === 'string') {
    if (!def.options?.some((o) => o.value === req.body.option)) {
      res.status(400).json({ error: 'Unknown option' });
      return;
    }
    data.option = req.body.option;
  }
  const current = await prisma.upstreamSource.findUnique({ where: { key: def.key } });
  const enabled = await sourceEnabled(def, current);
  await prisma.upstreamSource.upsert({
    where: { key: def.key },
    create: {
      key: def.key,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : enabled,
      option: typeof data.option === 'string' ? data.option : null,
    },
    update: data,
  });
  res.json({ ok: true });
});

const idList = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger).slice(0, 2000) : []);

// POST /api/upstream/import { ids, status?: 'draft' | 'source', convertTo? } — import selected items
router.post('/import', canImport, async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) {
    res.status(400).json({ error: 'Select items to import' });
    return;
  }
  const items = await prisma.upstreamItem.findMany({ where: { id: { in: ids } }, select: { id: true, format: true, externalId: true, title: true, path: true, content: true } });
  const wanted = new Set(items.map((i) => `${i.format}:${i.externalId ?? i.title.toLowerCase()}`));
  // One file per path; other rules of the same file are skipped
  const files = Array.from(new Map(items.map((i) => [i.path, { name: i.path, content: i.content }])).values());
  const skip = files.flatMap((f) =>
    parseRuleFile(f.name, f.content)
      .filter((e) => !e.rule || !wanted.has(`${e.rule.format}:${e.rule.externalId ?? e.rule.title.toLowerCase()}`))
      .map((e) => e.where)
  );
  const result = await runImport(
    {
      files,
      overwrite: true,
      status: req.body?.status === 'source' ? 'source' : 'draft',
      convertTo: req.body?.convertTo === null ? null : typeof req.body?.convertTo === 'string' ? req.body.convertTo : 'splunk',
      skip,
    },
    req.user?.userId ?? null
  );
  // Imported (or now unchanged) items are done
  const failed = new Set(result.errors.map((e) => e.file));
  await prisma.upstreamItem.deleteMany({ where: { id: { in: items.filter((i) => !failed.has(i.path)).map((i) => i.id) } } });
  res.json(result);
});

// POST /api/upstream/dismiss { ids } — ignore these versions (a later upstream change shows again)
router.post('/dismiss', canImport, async (req, res) => {
  const ids = idList(req.body?.ids);
  const items = await prisma.upstreamItem.findMany({ where: { id: { in: ids } }, select: { id: true, format: true, externalId: true, title: true, contentHash: true } });
  if (items.length) {
    await prisma.upstreamDismissal.createMany({
      data: items.map((i) => ({ key: dismissalKey(i), userId: req.user?.userId ?? null })),
      skipDuplicates: true,
    });
    await prisma.upstreamItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  }
  res.json({ dismissed: items.length });
});

export default router;
