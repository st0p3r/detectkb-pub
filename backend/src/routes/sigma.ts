import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { importRules } from './rule-import';
import {
  SigmaServiceError,
  convertSigma,
  getSigmaTargets,
  ruleToSigma,
} from '../lib/sigma';

const router = Router();

function sendServiceError(res: import('express').Response, err: unknown) {
  if (err instanceof SigmaServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /api/sigma/targets — conversion targets offered by the Sigma service
router.get('/targets', async (_req, res) => {
  try {
    res.json({ available: true, targets: await getSigmaTargets() });
  } catch (err) {
    if (err instanceof SigmaServiceError) {
      res.json({ available: false, targets: [], error: err.message });
      return;
    }
    throw err;
  }
});

// POST /api/sigma/convert — { rule: <sigma yaml>, target: "splunk" | "kusto_xdr" | ... }
router.post('/convert', requirePermission('rules:read'), async (req, res) => {
  const { rule, target } = req.body as { rule?: string; target?: string };
  if (!rule || !target) {
    res.status(400).json({ error: 'rule and target are required' });
    return;
  }
  try {
    res.json(await convertSigma(rule, target));
  } catch (err) {
    sendServiceError(res, err);
  }
});

// POST /api/sigma/import — kept for compatibility; accepts every supported format
router.post('/import', requirePermission('rules:create'), importRules);

async function loadRulesForExport(where: object) {
  const rules = await prisma.detectionRule.findMany({
    where,
    include: {
      page: {
        select: {
          id: true,
          title: true,
          slug: true,
          contentMd: true,
          sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } },
        },
      },
    },
    orderBy: { page: { title: 'asc' } },
  });

  const out: { slug: string; yaml: string; isSkeleton: boolean }[] = [];
  for (const r of rules) {
    const { yaml, sigmaId, isSkeleton } = ruleToSigma({
      ...r,
      title: r.page.title,
      contentMd: r.page.contentMd,
      sysmonEventIds: r.page.sysmonEvents.map((s) => s.sysmonEvent.eventId).sort((a, b) => a - b),
    });
    // Keep the generated id so repeated exports produce the same Sigma rule id
    if (!r.sigmaId) await prisma.detectionRule.update({ where: { id: r.id }, data: { sigmaId } });
    out.push({ slug: r.page.slug, yaml, isSkeleton });
  }
  return out;
}

// GET /api/sigma/export/:pageId — one rule as Sigma YAML (a skeleton if it has no Sigma source)
router.get('/export/:pageId', requirePermission('rules:read'), async (req, res) => {
  const pageId = Number(req.params.pageId);
  if (isNaN(pageId)) {
    res.status(400).json({ error: 'Invalid pageId' });
    return;
  }
  const [rule] = await loadRulesForExport({ pageId });
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${rule.slug}.yml"`);
  res.setHeader('X-Sigma-Skeleton', String(rule.isSkeleton));
  res.send(rule.yaml);
});

// GET /api/sigma/export?status=production,testing&skeletons=1 — all rules as one multi-document YAML
router.get('/export', requirePermission('rules:read'), async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.split(',') : null;
  const includeSkeletons = req.query.skeletons === '1' || req.query.skeletons === 'true';
  const where = {
    ...(status ? { status: { in: status } } : {}),
    ...(includeSkeletons ? {} : { sigmaYaml: { not: null } }),
  };
  const rules = await loadRulesForExport(where);
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="detectkb-sigma-rules.yml"');
  res.setHeader('X-Sigma-Rule-Count', String(rules.length));
  res.send(rules.map((r) => r.yaml.trimEnd()).join('\n---\n') + '\n');
});

export default router;
