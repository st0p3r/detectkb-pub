import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { generateUniqueSlug } from '../lib/slug';
import { syncPageLinks } from '../lib/links';
import { syncAutoSysmonLinks } from '../lib/sysmon-links';
import {
  SigmaServiceError,
  convertSigma,
  getSigmaTargets,
  parseSigmaDocuments,
  ruleToSigma,
  sigmaToRuleFields,
  validateSigmaRule,
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

interface ImportFile {
  name: string;
  content: string;
}

// POST /api/sigma/import — { files: [{ name, content }], overwrite?: bool, convertTo?: target | null }
router.post('/import', requirePermission('rules:create'), async (req, res) => {
  const { files, overwrite = false, convertTo = 'splunk' } = req.body as {
    files?: ImportFile[];
    overwrite?: boolean;
    convertTo?: string | null;
  };
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files is required' });
    return;
  }

  const created: { title: string; slug: string }[] = [];
  const updated: { title: string; slug: string }[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const errors: { file: string; error: string }[] = [];
  const warnings: string[] = [];
  let serviceDown = false;

  for (const file of files) {
    const docs = parseSigmaDocuments(String(file.content ?? ''));
    if (docs.length === 0) errors.push({ file: file.name, error: 'No YAML documents found' });

    for (const [index, { doc, error, source }] of docs.entries()) {
      const where = docs.length > 1 ? `${file.name} (document ${index + 1})` : file.name;
      const problem = error ?? validateSigmaRule(doc!);
      if (problem) {
        errors.push({ file: where, error: problem });
        continue;
      }

      const fields = sigmaToRuleFields(doc!);
      const sigmaYaml = source;
      const existing = fields.sigmaId
        ? await prisma.detectionRule.findFirst({ where: { sigmaId: fields.sigmaId }, include: { page: true } })
        : null;
      if (existing && !overwrite) {
        skipped.push({ title: fields.title, reason: `already imported as "${existing.page.title}"` });
        continue;
      }

      let splQuery = existing?.splQuery ?? '';
      if (convertTo && !serviceDown) {
        try {
          const result = await convertSigma(sigmaYaml, convertTo);
          splQuery = result.queries.join('\n\n');
          if (!result.pipelineApplied) {
            warnings.push(`${fields.title}: no field mapping for this log source, query uses raw Sigma field names`);
          }
        } catch (err) {
          if (!(err instanceof SigmaServiceError)) throw err;
          if (err.status === 503) serviceDown = true;
          warnings.push(`${fields.title}: conversion failed — ${err.message}`);
        }
      }

      const ruleData = {
        status: fields.status,
        severity: fields.severity,
        splQuery,
        mitreTactics: fields.mitreTactics,
        mitreTechniques: fields.mitreTechniques,
        dataSource: fields.dataSource,
        falsePositives: fields.falsePositives,
        references: fields.references,
        sigmaId: fields.sigmaId,
        sigmaYaml,
      };

      let page;
      if (existing) {
        page = await prisma.page.update({
          where: { id: existing.pageId },
          data: {
            title: fields.title,
            slug: await generateUniqueSlug(fields.title, existing.pageId),
            contentMd: fields.contentMd,
            rule: { update: ruleData },
          },
        });
        updated.push({ title: page.title, slug: page.slug });
      } else {
        const sigmaTag = await prisma.tag.upsert({ where: { name: 'sigma' }, create: { name: 'sigma' }, update: {} });
        page = await prisma.page.create({
          data: {
            title: fields.title,
            slug: await generateUniqueSlug(fields.title),
            contentMd: fields.contentMd,
            type: 'RULE',
            createdById: req.user?.userId ?? null,
            tags: { create: [{ tagId: sigmaTag.id }] },
            rule: { create: ruleData },
          },
        });
        created.push({ title: page.title, slug: page.slug });
      }
      await syncPageLinks(page.id, fields.contentMd);
      await syncAutoSysmonLinks(page.id);
    }
  }

  if (serviceDown) warnings.unshift('Sigma conversion service is not reachable — rules were imported without a query.');

  await prisma.auditLog.create({
    data: {
      userId: req.user?.userId ?? null,
      action: 'SIGMA_IMPORT',
      resourceType: 'rule',
      newValue: { created: created.length, updated: updated.length, skipped: skipped.length, errors: errors.length },
    },
  });

  res.json({ created, updated, skipped, errors, warnings });
});

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
