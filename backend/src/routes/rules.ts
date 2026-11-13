import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ownerField, reviewDateField, sigmaFields, text } from '../lib/rule-fields';
import { syncDerivedLinks } from '../lib/derived-links';
import { replaceRetiredTechniques } from '../lib/attack';
import { loadMissingFields, loadRuleFeeds } from '../lib/collection';
import { loadRuleTelemetry } from '../lib/coverage-analysis';
import { buildRunbook } from '../lib/runbook-data';
import { nextReviewDate } from '../lib/runbook';
import type { Request } from 'express';
import {
  RULE_LIST_SELECT,
  RULE_SEVERITIES,
  RULE_STATUSES,
  enumSlices,
  parseRuleListQuery,
  ruleOrderBy,
  ruleWhere,
} from '../lib/rule-list';

const router = Router();

const OWNER_SELECT = { select: { id: true, username: true } } as const;

/** The list filters of a request; "owner=me" and "logs=" need the caller and the collection answers. */
async function listQuery(req: Request, raw: Record<string, unknown> = req.query) {
  const f = parseRuleListQuery(raw);
  if (f.owner === 'me') f.owner = req.user?.userId ? String(req.user.userId) : 'none';
  if (f.logs === 'fed' || f.logs === 'blind' || f.logs === 'unknown') {
    const [feeds, rules] = await Promise.all([loadRuleFeeds(), loadRuleTelemetry()]);
    f.pageIds = rules.filter((r) => feeds.feed(r.pageId) === f.logs).map((r) => r.pageId);
  }
  if (f.field === 'missing') {
    const missing = new Set((await loadMissingFields()).keys());
    f.pageIds = f.pageIds ? f.pageIds.filter((id) => missing.has(id)) : Array.from(missing);
  }
  return f;
}

const RULE_PAGE_SELECT = {
  id: true,
  title: true,
  slug: true,
  type: true,
  updatedAt: true,
  tags: { include: { tag: true } },
};

// GET /api/rules — the rule list. With ?page= it is paged, filtered, searched
// and sorted server-side and returns { items, total, page, pageSize,
// statusCounts }; without it, every matching rule (list columns only).
router.get('/', async (req, res) => {
  const f = await listQuery(req);
  const where = ruleWhere(f);

  if (req.query.page === undefined) {
    res.json(await prisma.detectionRule.findMany({ where, select: RULE_LIST_SELECT, orderBy: ruleOrderBy('updatedAt', 'desc') }));
    return;
  }

  const [total, byStatus] = await Promise.all([
    prisma.detectionRule.count({ where }),
    prisma.detectionRule.groupBy({ by: ['status'], where: ruleWhere(f, 'status'), _count: { _all: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / f.pageSize));
  const page = Math.min(f.page, pageCount);
  const skip = (page - 1) * f.pageSize;

  let items;
  if (f.sort === 'status' || f.sort === 'severity') {
    const field = f.sort;
    const order = field === 'status' ? RULE_STATUSES : RULE_SEVERITIES;
    const counts = new Map(
      (
        await prisma.detectionRule.groupBy({ by: [field], where, _count: { _all: true } })
      ).map((g) => [g[field], g._count._all])
    );
    const slices = enumSlices(f.dir === 'asc' ? order : [...order].reverse(), counts, skip, f.pageSize);
    const parts = await Promise.all(
      slices.map((s) =>
        prisma.detectionRule.findMany({
          where: { AND: [where, { [field]: s.value }] },
          select: RULE_LIST_SELECT,
          orderBy: ruleOrderBy('updatedAt', 'desc'),
          skip: s.skip,
          take: s.take,
        })
      )
    );
    items = parts.flat();
  } else {
    items = await prisma.detectionRule.findMany({
      where,
      select: RULE_LIST_SELECT,
      orderBy: ruleOrderBy(f.sort, f.dir),
      skip,
      take: f.pageSize,
    });
  }

  // Whether each rule's logs are collected, once someone filled that in
  const feeds = await loadRuleFeeds();
  if (feeds.active) items = items.map((i) => ({ ...i, feed: feeds.feed(i.pageId) }));
  // Fields the rule reads that are marked as missing from the events
  const missingFields = await loadMissingFields();
  if (missingFields.size) items = items.map((i) => (missingFields.has(i.pageId) ? { ...i, missingFields: missingFields.get(i.pageId) } : i));

  res.json({
    items,
    total,
    page,
    pageSize: f.pageSize,
    statusCounts: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
  });
});

// GET /api/rules/ids?<list filters> — ids of every matching rule ("select all")
router.get('/ids', async (req, res) => {
  const rules = await prisma.detectionRule.findMany({ where: ruleWhere(await listQuery(req)), select: { id: true }, orderBy: { id: 'asc' } });
  res.json(rules.map((r) => r.id));
});

// GET /api/rules/owners — the people a rule can be assigned to, with how many rules each owns
router.get('/owners', async (_req, res) => {
  const [users, counts, unowned] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true, firstName: true, lastName: true }, orderBy: { username: 'asc' } }),
    prisma.detectionRule.groupBy({ by: ['ownerId'], where: { ownerId: { not: null } }, _count: { _all: true } }),
    prisma.detectionRule.count({ where: { ownerId: null } }),
  ]);
  const byOwner = new Map(counts.map((c) => [c.ownerId, c._count._all]));
  res.json({
    owners: users.map((u) => ({ id: u.id, username: u.username, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null, rules: byOwner.get(u.id) ?? 0 })),
    unowned,
  });
});

/** Rules a bulk action targets: explicit ids, or every rule matching a list filter. */
async function bulkTargets(body: Record<string, unknown>, req: Request) {
  // By page (the rules' pages, as the graph and impact analysis identify rules)
  if (Array.isArray(body.pageIds)) {
    const pageIds = body.pageIds.map(Number).filter(Number.isInteger);
    return pageIds.length ? prisma.detectionRule.findMany({ where: { pageId: { in: pageIds } }, select: { id: true, pageId: true } }) : [];
  }
  if (Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter(Number.isInteger);
    return ids.length ? prisma.detectionRule.findMany({ where: { id: { in: ids } }, select: { id: true, pageId: true } }) : [];
  }
  if (body.filter && typeof body.filter === 'object') {
    return prisma.detectionRule.findMany({
      where: ruleWhere(await listQuery(req, body.filter as Record<string, unknown>)),
      select: { id: true, pageId: true },
    });
  }
  return null;
}

const BULK_ACTIONS = ['status', 'severity', 'addTag', 'removeTag', 'replaceRetiredTechniques', 'owner', 'markReviewed'] as const;

// PUT /api/rules/bulk { ids | pageIds | filter, action, value }
//   action: status | severity | addTag | removeTag | replaceRetiredTechniques
//         | owner (value: a user id, or "" for no owner) | markReviewed
router.put('/bulk', async (req, res) => {
  const { action } = req.body ?? {};
  const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
  if (!BULK_ACTIONS.includes(action)) return res.status(400).json({ error: `action must be one of ${BULK_ACTIONS.join(', ')}` });
  if (action === 'status' && !RULE_STATUSES.includes(value)) return res.status(400).json({ error: 'Invalid status' });
  if (action === 'severity' && !RULE_SEVERITIES.includes(value)) return res.status(400).json({ error: 'Invalid severity' });
  if ((action === 'addTag' || action === 'removeTag') && (!value || value.length > 80))
    return res.status(400).json({ error: 'Tag name must be 1–80 characters' });

  const owner = action === 'owner' ? await ownerField(value) : {};
  if (typeof owner === 'string') return res.status(400).json({ error: owner });

  const targets = await bulkTargets(req.body, req);
  if (!targets) return res.status(400).json({ error: 'Send ids, pageIds or filter' });
  const ids = targets.map((t) => t.id);
  const pageIds = targets.map((t) => t.pageId);

  let changed = 0;
  const replacements: Record<string, string> = {};
  if (action === 'replaceRetiredTechniques') {
    const rules = await prisma.detectionRule.findMany({ where: { id: { in: ids } }, select: { id: true, mitreTechniques: true } });
    for (const r of rules) {
      const { text, replaced } = replaceRetiredTechniques(r.mitreTechniques);
      if (!replaced.length) continue;
      const rule = await prisma.detectionRule.update({ where: { id: r.id }, data: { mitreTechniques: text }, select: { pageId: true } });
      await syncDerivedLinks(rule.pageId);
      for (const [from, to] of replaced) replacements[from] = to;
      changed++;
    }
  } else if (action === 'owner') {
    changed = (await prisma.detectionRule.updateMany({ where: { id: { in: ids } }, data: { ownerId: owner.ownerId ?? null } })).count;
  } else if (action === 'markReviewed') {
    const now = new Date();
    changed = (await prisma.detectionRule.updateMany({ where: { id: { in: ids } }, data: { lastReviewedAt: now, nextReviewAt: nextReviewDate(now) } })).count;
  } else if (action === 'status' || action === 'severity') {
    changed = (await prisma.detectionRule.updateMany({ where: { id: { in: ids }, [action]: { not: value } }, data: { [action]: value } })).count;
  } else if (action === 'addTag') {
    const tag = await prisma.tag.upsert({ where: { name: value }, create: { name: value }, update: {} });
    changed = (
      await prisma.tagsOnPages.createMany({ data: pageIds.map((pageId) => ({ pageId, tagId: tag.id })), skipDuplicates: true })
    ).count;
  } else {
    const tag = await prisma.tag.findUnique({ where: { name: value } });
    if (tag) {
      changed = (await prisma.tagsOnPages.deleteMany({ where: { tagId: tag.id, pageId: { in: pageIds } } })).count;
      await prisma.tag.deleteMany({ where: { id: tag.id, pages: { none: {} } } });
    }
  }

  await prisma.auditLog.create({
    data: { userId: req.user?.userId ?? null, action: 'RULE_BULK_UPDATE', resourceType: 'rule', newValue: { action, value, rules: ids.length, changed, ...(action === 'replaceRetiredTechniques' && { replacements }) } },
  });
  res.json({ matched: ids.length, changed, ...(action === 'replaceRetiredTechniques' && { replacements }) });
});

// DELETE /api/rules/bulk { ids | filter } — deletes the rules' pages
router.delete('/bulk', async (req, res) => {
  const targets = await bulkTargets(req.body ?? {}, req);
  if (!targets) return res.status(400).json({ error: 'Send ids, pageIds or filter' });
  const pageIds = targets.map((t) => t.pageId);
  const { count } = await prisma.page.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.tag.deleteMany({ where: { pages: { none: {} } } });
  await prisma.auditLog.create({
    data: { userId: req.user?.userId ?? null, action: 'RULE_BULK_DELETE', resourceType: 'rule', newValue: { deleted: count } },
  });
  res.json({ deleted: count });
});

// GET /api/rules/:pageId/runbook — the rule as the analyst handling its alert needs it
router.get('/:pageId/runbook', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (isNaN(pageId)) return res.status(400).json({ error: 'Invalid pageId' });
  const runbook = await buildRunbook(pageId);
  if (!runbook) return res.status(404).json({ error: 'Rule not found' });
  res.json(runbook);
});

// PUT /api/rules/:id/review { nextReviewAt? } — the rule was looked at and still
// holds: sets the review date to now and the next one REVIEW_INTERVAL_DAYS ahead
router.put('/:id/review', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const next = reviewDateField(req.body?.nextReviewAt);
  if (typeof next === 'string') return res.status(400).json({ error: next });
  const now = new Date();
  const rule = await prisma.detectionRule.update({
    where: { id },
    data: { lastReviewedAt: now, nextReviewAt: next.nextReviewAt === undefined ? nextReviewDate(now) : next.nextReviewAt },
    select: { id: true, pageId: true, lastReviewedAt: true, nextReviewAt: true },
  });
  await prisma.auditLog.create({
    data: { userId: req.user?.userId ?? null, action: 'RULE_REVIEWED', resourceType: 'rule', resourceId: rule.id, newValue: { nextReviewAt: rule.nextReviewAt } },
  });
  res.json(rule);
});

// GET /api/rules/:pageId — get single rule by pageId
router.get('/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (isNaN(pageId)) return res.status(400).json({ error: 'Invalid pageId' });

  const rule = await prisma.detectionRule.findUnique({
    where: { pageId },
    include: { page: { select: RULE_PAGE_SELECT }, owner: OWNER_SELECT },
  });

  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
});

// POST /api/rules — create or upsert a DetectionRule for a page
router.post('/', async (req, res) => {
  const {
    pageId,
    status = 'draft',
    severity = 'medium',
    splQuery = '',
    mitreTactics,
    mitreTechniques,
    dataSource,
    falsePositives,
    references,
    testNotes,
    sigmaYaml,
    nativeQuery,
    nativeLanguage,
    triage,
    response,
  } = req.body;

  if (!pageId) return res.status(400).json({ error: 'pageId is required' });
  const sigma = await sigmaFields(sigmaYaml, Number(pageId));
  if (typeof sigma === 'string') return res.status(400).json({ error: sigma });
  const owner = await ownerField(req.body.ownerId);
  if (typeof owner === 'string') return res.status(400).json({ error: owner });
  const review = reviewDateField(req.body.nextReviewAt);
  if (typeof review === 'string') return res.status(400).json({ error: review });

  const ruleData = {
    status,
    severity,
    splQuery,
    mitreTactics: mitreTactics ?? null,
    mitreTechniques: mitreTechniques ?? null,
    dataSource: dataSource ?? null,
    falsePositives: falsePositives ?? null,
    references: references ?? null,
    testNotes: testNotes ?? null,
    ...(nativeQuery !== undefined && { nativeQuery: nativeQuery || null }),
    ...(nativeLanguage !== undefined && { nativeLanguage: nativeLanguage || null }),
    ...(triage !== undefined && { triage: text(triage) }),
    ...(response !== undefined && { response: text(response) }),
    ...owner,
    ...review,
    ...sigma,
  };

  const rule = await prisma.detectionRule.upsert({
    where: { pageId: Number(pageId) },
    create: { pageId: Number(pageId), ...ruleData },
    update: ruleData,
    include: { page: { select: RULE_PAGE_SELECT }, owner: OWNER_SELECT },
  });
  await syncDerivedLinks(rule.pageId);

  res.status(201).json(rule);
});

// PUT /api/rules/:id — update an existing DetectionRule by its own id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await prisma.detectionRule.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const {
    status,
    severity,
    splQuery,
    mitreTactics,
    mitreTechniques,
    dataSource,
    falsePositives,
    references,
    testNotes,
    sigmaYaml,
    nativeQuery,
    nativeLanguage,
    triage,
    response,
  } = req.body;

  const sigma = await sigmaFields(sigmaYaml, existing.pageId);
  if (typeof sigma === 'string') return res.status(400).json({ error: sigma });
  const owner = await ownerField(req.body.ownerId);
  if (typeof owner === 'string') return res.status(400).json({ error: owner });
  const review = reviewDateField(req.body.nextReviewAt);
  if (typeof review === 'string') return res.status(400).json({ error: review });

  const rule = await prisma.detectionRule.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(severity !== undefined && { severity }),
      ...(splQuery !== undefined && { splQuery }),
      ...(mitreTactics !== undefined && { mitreTactics }),
      ...(mitreTechniques !== undefined && { mitreTechniques }),
      ...(dataSource !== undefined && { dataSource }),
      ...(falsePositives !== undefined && { falsePositives }),
      ...(references !== undefined && { references }),
      ...(testNotes !== undefined && { testNotes }),
      ...(nativeQuery !== undefined && { nativeQuery: nativeQuery || null }),
      ...(nativeLanguage !== undefined && { nativeLanguage: nativeLanguage || null }),
      ...(triage !== undefined && { triage: text(triage) }),
      ...(response !== undefined && { response: text(response) }),
      ...owner,
      ...review,
      ...sigma,
    },
    include: { page: { select: RULE_PAGE_SELECT }, owner: OWNER_SELECT },
  });
  await syncDerivedLinks(rule.pageId);

  res.json(rule);
});

// DELETE /api/rules/:id — delete rule (page stays)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await prisma.detectionRule.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  await prisma.detectionRule.delete({ where: { id } });
  await syncDerivedLinks(existing.pageId);
  res.status(204).send();
});

export default router;
