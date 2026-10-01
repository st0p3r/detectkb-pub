import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { queryText } from '../lib/rule-text';
import { RUN_RESULTS, RunResult, ValidationStatus, loadValidation, ruleQueryHash, toSavedSearches } from '../lib/validation';

// Lab validation: recording test runs against rules, each rule's status, and
// the rules as Splunk saved searches for the lab.

const router = Router();
const canRecord = requirePermission('rules:update');

const runSelect = {
  id: true,
  pageId: true,
  atomicGuid: true,
  techniqueId: true,
  testName: true,
  result: true,
  executedAt: true,
  environment: true,
  evidence: true,
  notes: true,
  queryHash: true,
  createdAt: true,
  recordedBy: { select: { username: true } },
} as const;

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// POST /api/validation/runs — one test run with a result for one or more rules:
// { atomicGuid? | testName, executedAt?, environment?, notes?, results: [{ pageId, result, evidence? }] }
router.post('/runs', canRecord, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const results = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
  if (!results.length || results.length > 500) {
    res.status(400).json({ error: 'Give a result for 1–500 rules' });
    return;
  }
  for (const r of results) {
    if (!Number.isInteger(r?.pageId) || !RUN_RESULTS.includes(r?.result as RunResult)) {
      res.status(400).json({ error: `Each result needs a rule (pageId) and one of: ${RUN_RESULTS.join(', ')}` });
      return;
    }
  }

  const atomicGuid = str(body.atomicGuid, 64);
  const atomic = atomicGuid ? await prisma.atomicTest.findUnique({ where: { guid: atomicGuid }, select: { guid: true, techniqueId: true, name: true } }) : null;
  if (atomicGuid && !atomic) {
    res.status(400).json({ error: 'Unknown Atomic Red Team test' });
    return;
  }
  const testName = atomic?.name ?? str(body.testName, 500);
  if (!testName) {
    res.status(400).json({ error: 'Pick an Atomic Red Team test or name the test' });
    return;
  }
  const executedAt = body.executedAt ? new Date(String(body.executedAt)) : new Date();
  if (Number.isNaN(executedAt.getTime()) || executedAt.getTime() > Date.now() + 5 * 60000) {
    res.status(400).json({ error: 'executedAt must be a valid time, not in the future' });
    return;
  }

  const pageIds = Array.from(new Set(results.map((r) => r.pageId as number)));
  const rules = await prisma.detectionRule.findMany({ where: { pageId: { in: pageIds } }, select: { pageId: true, splQuery: true, nativeQuery: true, sigmaYaml: true } });
  const hashes = new Map(rules.map((r) => [r.pageId, ruleQueryHash(queryText(r))]));
  const missing = pageIds.filter((id) => !hashes.has(id));
  if (missing.length) {
    res.status(400).json({ error: `Not detection rules: ${missing.join(', ')}` });
    return;
  }

  const shared = {
    atomicGuid: atomic?.guid ?? null,
    techniqueId: atomic?.techniqueId ?? (str(body.techniqueId, 20)?.toUpperCase() || null),
    testName,
    executedAt,
    environment: str(body.environment, 191),
    notes: str(body.notes, 5000),
    recordedById: req.user?.userId ?? null,
  };
  const created = await prisma.$transaction(
    results.map((r) =>
      prisma.ruleTestRun.create({
        data: { ...shared, pageId: r.pageId as number, result: r.result as RunResult, evidence: str(r.evidence, 5000), queryHash: hashes.get(r.pageId as number)! },
        select: { id: true },
      })
    )
  );
  res.status(201).json({ recorded: created.length });
});

// DELETE /api/validation/runs/:id
router.delete('/runs/:id', canRecord, async (req, res) => {
  const id = Number(req.params.id);
  const run = await prisma.ruleTestRun.findUnique({ where: { id }, select: { id: true } });
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  await prisma.ruleTestRun.delete({ where: { id } });
  res.json({ ok: true });
});

// GET /api/validation/rule/:pageId — the rule's status and its runs, newest first
router.get('/rule/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const rule = await prisma.detectionRule.findUnique({ where: { pageId }, select: { splQuery: true, nativeQuery: true, sigmaYaml: true } });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  const [runs, validation] = await Promise.all([
    prisma.ruleTestRun.findMany({ where: { pageId }, select: runSelect, orderBy: [{ executedAt: 'desc' }, { id: 'desc' }] }),
    loadValidation(),
  ]);
  const currentHash = ruleQueryHash(queryText(rule));
  res.json({
    pageId,
    ...validation(pageId),
    runs: runs.map(({ queryHash, ...r }) => ({ ...r, queryChangedSince: queryHash !== currentHash })),
  });
});

// GET /api/validation/atomic/:guid — runs of an Atomic Red Team test across rules
router.get('/atomic/:guid', async (req, res) => {
  const runs = await prisma.ruleTestRun.findMany({
    where: { atomicGuid: String(req.params.guid) },
    select: { ...runSelect, page: { select: { title: true, slug: true } } },
    orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
  });
  res.json({ runs: runs.map(({ queryHash: _h, ...r }) => r) });
});

// GET /api/validation/statuses — pageId → status for every rule with runs (others: never)
router.get('/statuses', async (_req, res) => {
  const [validation, pages] = await Promise.all([loadValidation(), prisma.ruleTestRun.findMany({ distinct: ['pageId'], select: { pageId: true } })]);
  res.json(Object.fromEntries(pages.map((p) => [p.pageId, validation(p.pageId).status])));
});

// GET /api/validation/summary — rules per validation status, by rule status
router.get('/summary', async (_req, res) => {
  const [rules, validation] = await Promise.all([
    prisma.detectionRule.findMany({ where: { status: { not: 'deprecated' } }, select: { pageId: true, status: true } }),
    loadValidation(),
  ]);
  const counts: Record<string, Record<ValidationStatus, number>> = {};
  for (const r of rules) {
    const c = (counts[r.status] ??= { validated: 0, partial: 0, failed: 0, stale: 0, never: 0 });
    c[validation(r.pageId).status]++;
  }
  res.json({ byRuleStatus: counts });
});

// GET /api/validation/export/savedsearches?status=production,testing&scope=all|with-tests&pageIds=1,2
// The rules' SPL as savedsearches.conf for the lab Splunk
router.get('/export/savedsearches', async (req, res) => {
  const pageIds = String(req.query.pageIds ?? '')
    .split(',')
    .map(Number)
    .filter(Number.isInteger)
    .filter((n) => n > 0);
  const statuses = String(req.query.status ?? 'production,testing')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const rules = await prisma.detectionRule.findMany({
    where: { ...(pageIds.length ? { pageId: { in: pageIds } } : { status: { in: statuses } }), NOT: { splQuery: '' } },
    select: { pageId: true, severity: true, splQuery: true, mitreTechniques: true, page: { select: { title: true, slug: true } } },
    orderBy: { page: { title: 'asc' } },
  });
  let selected = rules.filter((r) => r.splQuery.trim());
  if (!pageIds.length && req.query.scope === 'with-tests') {
    // Rules of techniques that have an Atomic Red Team test (a parent-technique rule covers its sub-techniques' tests)
    const tested = new Set((await prisma.atomicTest.findMany({ distinct: ['techniqueId'], select: { techniqueId: true } })).map((t) => t.techniqueId));
    const testedParents = new Set(Array.from(tested, (t) => t.split('.')[0]));
    selected = selected.filter((r) =>
      parseTechniqueIds(r.mitreTechniques)
        .map((t) => resolveTechniqueId(t) ?? t)
        .some((t) => tested.has(t) || (!t.includes('.') && testedParents.has(t)))
    );
  }
  const text = toSavedSearches(
    selected.map((r) => ({
      pageId: r.pageId,
      title: r.page.title,
      slug: r.page.slug,
      severity: r.severity,
      techniques: Array.from(new Set(parseTechniqueIds(r.mitreTechniques).map((t) => resolveTechniqueId(t) ?? t))),
      splQuery: r.splQuery,
    }))
  );
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="savedsearches.conf"');
  res.setHeader('X-Rule-Count', String(selected.length));
  res.send(text);
});

export default router;
