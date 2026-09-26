import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { parseSingleSigmaRule } from '../lib/sigma';
import { syncAutoSysmonLinks } from '../lib/sysmon-links';

const router = Router();

/**
 * Validates optional Sigma YAML from a request body. Returns the fields to
 * store, `{}` when sigmaYaml was not sent, or an error message.
 */
async function sigmaFields(
  sigmaYaml: unknown,
  pageId: number
): Promise<{ sigmaYaml?: string | null; sigmaId?: string } | string> {
  if (sigmaYaml === undefined) return {};
  if (sigmaYaml === null || String(sigmaYaml).trim() === '') return { sigmaYaml: null };
  let doc;
  try {
    doc = parseSingleSigmaRule(String(sigmaYaml));
  } catch (err) {
    return (err as Error).message;
  }
  if (!doc.id) return { sigmaYaml: String(sigmaYaml) };
  const sigmaId = String(doc.id);
  const clash = await prisma.detectionRule.findFirst({ where: { sigmaId }, include: { page: true } });
  if (clash && clash.pageId !== pageId) return `Sigma id ${sigmaId} is already used by "${clash.page.title}"`;
  return { sigmaYaml: String(sigmaYaml), sigmaId };
}

const RULE_PAGE_SELECT = {
  id: true,
  title: true,
  slug: true,
  type: true,
  updatedAt: true,
  tags: { include: { tag: true } },
};

// GET /api/rules — list all rules with page info, supports filters
router.get('/', async (req, res) => {
  const { status, severity, technique, dataSource } = req.query;

  const where: Record<string, unknown> = {};
  if (status) where.status = String(status);
  if (severity) where.severity = String(severity);
  if (technique) where.mitreTechniques = { contains: String(technique) };
  if (dataSource) where.dataSource = { contains: String(dataSource) };

  const rules = await prisma.detectionRule.findMany({
    where,
    include: { page: { select: RULE_PAGE_SELECT } },
    orderBy: { page: { updatedAt: 'desc' } },
  });

  res.json(rules);
});

// GET /api/rules/:pageId — get single rule by pageId
router.get('/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (isNaN(pageId)) return res.status(400).json({ error: 'Invalid pageId' });

  const rule = await prisma.detectionRule.findUnique({
    where: { pageId },
    include: { page: { select: RULE_PAGE_SELECT } },
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
  } = req.body;

  if (!pageId) return res.status(400).json({ error: 'pageId is required' });
  const sigma = await sigmaFields(sigmaYaml, Number(pageId));
  if (typeof sigma === 'string') return res.status(400).json({ error: sigma });

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
    ...sigma,
  };

  const rule = await prisma.detectionRule.upsert({
    where: { pageId: Number(pageId) },
    create: { pageId: Number(pageId), ...ruleData },
    update: ruleData,
    include: { page: { select: RULE_PAGE_SELECT } },
  });
  await syncAutoSysmonLinks(rule.pageId);

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
  } = req.body;

  const sigma = await sigmaFields(sigmaYaml, existing.pageId);
  if (typeof sigma === 'string') return res.status(400).json({ error: sigma });

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
      ...sigma,
    },
    include: { page: { select: RULE_PAGE_SELECT } },
  });
  await syncAutoSysmonLinks(rule.pageId);

  res.json(rule);
});

// DELETE /api/rules/:id — delete rule (page stays)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await prisma.detectionRule.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  await prisma.detectionRule.delete({ where: { id } });
  await syncAutoSysmonLinks(existing.pageId);
  res.status(204).send();
});

export default router;
