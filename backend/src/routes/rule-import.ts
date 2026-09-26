import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { generateUniqueSlug } from '../lib/slug';
import { syncPageLinks } from '../lib/links';
import { syncAutoSysmonLinks } from '../lib/sysmon-links';
import { SigmaServiceError, convertSigma } from '../lib/sigma';
import { FORMAT_LABELS, FORMAT_TAGS, ImportFormat, ImportedRule, parseRuleFile } from '../lib/rule-import';

const router = Router();

interface ImportFile {
  name: string;
  content: string;
}

async function findExisting(rule: ImportedRule) {
  if (!rule.externalId) return null;
  const where =
    rule.format === 'sigma'
      ? { sigmaId: rule.externalId }
      : { sourceFormat: rule.format, sourceId: rule.externalId };
  return prisma.detectionRule.findFirst({ where, include: { page: true } });
}

/**
 * POST /api/rules-import
 * { files: [{ name, content }], overwrite?: bool, convertTo?: sigma target | null, status?: 'draft' | 'source' }
 *
 * Accepts Sigma / Splunk ESCU / Sentinel YAML and Elastic TOML (detected per file).
 * Imported rules are drafts by default: a vendor's "production" does not mean
 * the rule works on your data.
 */
export async function importRules(req: Request, res: Response) {
  const { files, overwrite = false, convertTo = 'splunk', status = 'draft' } = req.body as {
    files?: ImportFile[];
    overwrite?: boolean;
    convertTo?: string | null;
    status?: 'draft' | 'source';
  };
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files is required' });
    return;
  }

  const created: { title: string; slug: string; format: ImportFormat }[] = [];
  const updated: { title: string; slug: string; format: ImportFormat }[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const errors: { file: string; error: string }[] = [];
  const warnings: string[] = [];
  let serviceDown = false;
  const tagIds = new Map<ImportFormat, number>();

  for (const file of files) {
    for (const entry of parseRuleFile(String(file.name ?? 'file'), String(file.content ?? ''))) {
      if (!entry.rule) {
        errors.push({ file: entry.where, error: entry.error ?? 'Unknown error' });
        continue;
      }
      const rule = entry.rule;
      if (!rule.title) {
        errors.push({ file: entry.where, error: 'Rule has no title/name' });
        continue;
      }

      // One bad rule must not abort the rest of the batch
      try {
        const existing = await findExisting(rule);
        if (existing && !overwrite) {
          skipped.push({ title: rule.title, reason: `already imported as "${existing.page.title}"` });
          continue;
        }

        let splQuery = rule.splQuery || existing?.splQuery || '';
        if (rule.format === 'sigma' && convertTo && !serviceDown) {
          try {
            const result = await convertSigma(rule.sigmaYaml!, convertTo);
            splQuery = result.queries.join('\n\n');
            if (!result.pipelineApplied) {
              warnings.push(`${rule.title}: no field mapping for this log source, query uses raw Sigma field names`);
            }
          } catch (err) {
            if (!(err instanceof SigmaServiceError)) throw err;
            if (err.status === 503) serviceDown = true;
            warnings.push(`${rule.title}: conversion failed — ${err.message}`);
          }
        }

        const ruleData = {
          status: status === 'source' ? rule.sourceStatus : existing?.status ?? 'draft',
          severity: rule.severity,
          splQuery,
          mitreTactics: rule.mitreTactics,
          mitreTechniques: rule.mitreTechniques,
          dataSource: rule.dataSource,
          falsePositives: rule.falsePositives,
          references: rule.references,
          sigmaId: rule.format === 'sigma' ? rule.externalId : existing?.sigmaId ?? null,
          sigmaYaml: rule.sigmaYaml ?? existing?.sigmaYaml ?? null,
          sourceFormat: rule.format,
          sourceId: rule.externalId,
          sourceContent: rule.format === 'sigma' ? null : rule.sourceContent,
          nativeQuery: rule.nativeQuery,
          nativeLanguage: rule.nativeLanguage,
        };

        let page;
        if (existing) {
          page = await prisma.page.update({
            where: { id: existing.pageId },
            data: {
              title: rule.title,
              slug: await generateUniqueSlug(rule.title, existing.pageId),
              contentMd: rule.contentMd,
              rule: { update: ruleData },
            },
          });
          updated.push({ title: page.title, slug: page.slug, format: rule.format });
        } else {
          if (!tagIds.has(rule.format)) {
            const name = FORMAT_TAGS[rule.format];
            const tag = await prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
            tagIds.set(rule.format, tag.id);
          }
          page = await prisma.page.create({
            data: {
              title: rule.title,
              slug: await generateUniqueSlug(rule.title),
              contentMd: rule.contentMd,
              type: 'RULE',
              createdById: req.user?.userId ?? null,
              tags: { create: [{ tagId: tagIds.get(rule.format)! }] },
              rule: { create: ruleData },
            },
          });
          created.push({ title: page.title, slug: page.slug, format: rule.format });
        }
        await syncPageLinks(page.id, rule.contentMd);
        await syncAutoSysmonLinks(page.id);
      } catch (err) {
        console.error(`[import] ${entry.where}:`, err);
        errors.push({ file: entry.where, error: `Could not save "${rule.title}": ${(err as Error).message.split('\n').pop()?.trim()}` });
      }
    }
  }

  if (serviceDown) warnings.unshift('Sigma conversion service is not reachable — Sigma rules were imported without SPL.');

  const byFormat = (list: { format: ImportFormat }[]) =>
    Object.fromEntries(
      (Object.keys(FORMAT_LABELS) as ImportFormat[])
        .map((f) => [f, list.filter((r) => r.format === f).length])
        .filter(([, n]) => n)
    );
  await prisma.auditLog.create({
    data: {
      userId: req.user?.userId ?? null,
      action: 'RULE_IMPORT',
      resourceType: 'rule',
      newValue: {
        created: byFormat(created),
        updated: byFormat(updated),
        skipped: skipped.length,
        errors: errors.length,
      },
    },
  });

  res.json({ created, updated, skipped, errors, warnings });
}

router.post('/', requirePermission('rules:create'), importRules);

export default router;
