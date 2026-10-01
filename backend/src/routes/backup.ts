import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { BACKUP_DIR } from '../lib/config';
import { requirePermission } from '../middleware/auth';
import { setManualSysmonLinks } from '../lib/sysmon-links';
import { syncAllDerivedLinks } from '../lib/derived-links';
import { saveStoryDetails } from '../lib/stories';

async function restoreManualSysmonLinks(
  pageId: number,
  links: { source: string; sysmonEvent: { eventId: number } }[] | undefined
) {
  const manual = (links ?? []).filter((l) => l.source === 'manual').map((l) => l.sysmonEvent.eventId);
  if (manual.length) await setManualSysmonLinks(pageId, manual);
}

interface BackupTestRun {
  atomicGuid?: string | null;
  techniqueId?: string | null;
  testName: string;
  result: string;
  executedAt: string;
  environment?: string | null;
  evidence?: string | null;
  notes?: string | null;
  queryHash: string;
  recordedBy?: { username: string } | null;
}

/** Restores a rule's lab test runs; runs already there (same test, time and result) are skipped. */
async function restoreTestRuns(pageId: number, runs: BackupTestRun[] | undefined) {
  if (!runs?.length) return;
  const existing = await prisma.ruleTestRun.findMany({ where: { pageId }, select: { atomicGuid: true, testName: true, executedAt: true, result: true } });
  const key = (r: { atomicGuid?: string | null; testName: string; executedAt: Date | string; result: string }) =>
    `${r.atomicGuid ?? ''}|${r.testName}|${new Date(r.executedAt).toISOString()}|${r.result}`;
  const have = new Set(existing.map(key));
  const users = new Map((await prisma.user.findMany({ select: { id: true, username: true } })).map((u) => [u.username, u.id]));
  const data = runs
    .filter((r) => r.testName && r.result && r.executedAt && r.queryHash && !have.has(key(r)))
    .map((r) => ({
      pageId,
      atomicGuid: r.atomicGuid ?? null,
      techniqueId: r.techniqueId ?? null,
      testName: r.testName,
      result: r.result,
      executedAt: new Date(r.executedAt),
      environment: r.environment ?? null,
      evidence: r.evidence ?? null,
      notes: r.notes ?? null,
      queryHash: r.queryHash,
      recordedById: r.recordedBy ? users.get(r.recordedBy.username) ?? null : null,
    }));
  if (data.length) await prisma.ruleTestRun.createMany({ data });
}

const router = Router();

// Listing/downloading backups exposes the full dataset, so it needs the same
// permission as creating one.
const canRead = requirePermission('backups:create');

export async function runJsonBackup(): Promise<{ fileName: string; sizeBytes: number; downloadUrl: string }> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const [pages, categories, tags] = await Promise.all([
    prisma.page.findMany({
      include: {
        tags: { include: { tag: true } },
        category: true,
        rule: true,
        splCommand: true,
        outLinks: true,
        sysmonEvents: { select: { source: true, sysmonEvent: { select: { eventId: true } } } },
        testRuns: {
          select: {
            atomicGuid: true,
            techniqueId: true,
            testName: true,
            result: true,
            executedAt: true,
            environment: true,
            evidence: true,
            notes: true,
            queryHash: true,
            recordedBy: { select: { username: true } },
          },
        },
      },
    }),
    prisma.category.findMany(),
    prisma.tag.findMany(),
  ]);
  // Story details come from uploaded / downloaded files; the rule links are rebuilt on restore
  const analyticStories = await prisma.analyticStory.findMany({
    where: { description: { not: null } },
    select: { name: true, externalId: true, description: true, narrative: true, references: true, category: true, usecase: true, detailsFrom: true },
  });

  const backup = { version: 1, exportedAt: new Date().toISOString(), pages, categories, tags, analyticStories };
  const timestamp = Date.now();
  const fileName = `detectkb-backup-${timestamp}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);

  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
  const sizeBytes = fs.statSync(filePath).size;

  await prisma.backupLog.create({ data: { fileName, sizeBytes, type: 'json' } });

  return { fileName, sizeBytes, downloadUrl: `/api/backup/download/${fileName}` };
}

router.post('/json', requirePermission('backups:create'), async (_req: Request, res: Response) => {
  const result = await runJsonBackup();
  res.json(result);
});

router.get('/list', canRead, async (_req: Request, res: Response) => {
  const logs = await prisma.backupLog.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(logs);
});

const BACKUP_FILE_NAME = /^detectkb-backup-[A-Za-z0-9_-]+\.json$/;

router.get('/download/:fileName', canRead, (req: Request, res: Response) => {
  // Only files this router wrote: BACKUP_DIR also holds other state (e.g. .secrets/)
  const safe = req.params.fileName;
  const filePath = path.join(BACKUP_DIR, safe);

  if (!BACKUP_FILE_NAME.test(safe) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(filePath, safe);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/restore/json', requirePermission('backups:restore'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  let backup: {
    analyticStories?: {
      name: string;
      externalId?: string | null;
      description?: string | null;
      narrative?: string | null;
      references?: unknown;
      category?: string | null;
      usecase?: string | null;
      detailsFrom?: string | null;
    }[];
    categories?: { name: string; color?: string; parentId?: number | null }[];
    tags?: { name: string }[];
    pages?: {
      title: string;
      slug: string;
      contentMd?: string;
      type?: string;
      isPinned?: boolean;
      categoryId?: number | null;
      category?: { name: string } | null;
      tags?: { tag: { name: string } }[];
      rule?: {
        status?: string;
        severity?: string;
        splQuery?: string;
        mitreTactics?: string;
        mitreTechniques?: string;
        dataSource?: string;
        falsePositives?: string;
        references?: string;
        testNotes?: string;
        sigmaId?: string | null;
        sigmaYaml?: string | null;
        sourceFormat?: string | null;
        sourceId?: string | null;
        sourceContent?: string | null;
        nativeQuery?: string | null;
        nativeLanguage?: string | null;
      } | null;
      sysmonEvents?: { source: string; sysmonEvent: { eventId: number } }[];
      testRuns?: BackupTestRun[];
      splCommand?: {
        command?: string;
        group?: string;
        syntax?: string;
        description?: string;
        examples?: string;
        pitfalls?: string;
        isFavorite?: boolean;
      } | null;
    }[];
  };

  try {
    backup = JSON.parse(req.file.buffer.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON file' });
    return;
  }

  let restored = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Upsert categories
  const categoryNameToId = new Map<string, number>();
  for (const cat of backup.categories || []) {
    try {
      const existing = await prisma.category.findFirst({ where: { name: cat.name } });
      if (existing) {
        categoryNameToId.set(cat.name, existing.id);
      } else {
        const created = await prisma.category.create({ data: { name: cat.name, color: cat.color } });
        categoryNameToId.set(cat.name, created.id);
      }
    } catch (e) {
      errors.push(`Category "${cat.name}": ${(e as Error).message}`);
    }
  }

  // Upsert tags
  const tagNameToId = new Map<string, number>();
  for (const tag of backup.tags || []) {
    try {
      const t = await prisma.tag.upsert({
        where: { name: tag.name },
        create: { name: tag.name },
        update: {},
      });
      tagNameToId.set(tag.name, t.id);
    } catch (e) {
      errors.push(`Tag "${tag.name}": ${(e as Error).message}`);
    }
  }

  // Upsert pages
  for (const p of backup.pages || []) {
    try {
      const categoryId = p.category?.name ? categoryNameToId.get(p.category.name) ?? null : null;
      const tagNames = (p.tags || []).map((t) => t.tag.name);

      const existing = await prisma.page.findUnique({ where: { slug: p.slug } });

      if (existing) {
        await prisma.page.update({
          where: { slug: p.slug },
          data: {
            title: p.title,
            contentMd: p.contentMd || '',
            type: (p.type as 'NOTE' | 'CONCEPT' | 'DATA_SOURCE' | 'RULE' | 'SPL_COMMAND') || 'NOTE',
            isPinned: p.isPinned || false,
            categoryId,
            tags: {
              deleteMany: {},
              create: tagNames
                .filter((n) => tagNameToId.has(n))
                .map((n) => ({ tag: { connect: { id: tagNameToId.get(n)! } } })),
            },
          },
        });

        if (p.rule) {
          await prisma.detectionRule.upsert({
            where: { pageId: existing.id },
            create: {
              pageId: existing.id,
              status: p.rule.status || 'draft',
              severity: p.rule.severity || 'medium',
              splQuery: p.rule.splQuery || '',
              mitreTactics: p.rule.mitreTactics,
              mitreTechniques: p.rule.mitreTechniques,
              dataSource: p.rule.dataSource,
              falsePositives: p.rule.falsePositives,
              references: p.rule.references,
              testNotes: p.rule.testNotes,
              sigmaId: p.rule.sigmaId ?? null,
              sigmaYaml: p.rule.sigmaYaml ?? null,
              sourceFormat: p.rule.sourceFormat ?? null,
              sourceId: p.rule.sourceId ?? null,
              sourceContent: p.rule.sourceContent ?? null,
              nativeQuery: p.rule.nativeQuery ?? null,
              nativeLanguage: p.rule.nativeLanguage ?? null,
            },
            update: {
              status: p.rule.status || 'draft',
              severity: p.rule.severity || 'medium',
              splQuery: p.rule.splQuery || '',
              mitreTactics: p.rule.mitreTactics,
              mitreTechniques: p.rule.mitreTechniques,
              dataSource: p.rule.dataSource,
              falsePositives: p.rule.falsePositives,
              references: p.rule.references,
              testNotes: p.rule.testNotes,
              sigmaId: p.rule.sigmaId ?? null,
              sigmaYaml: p.rule.sigmaYaml ?? null,
              sourceFormat: p.rule.sourceFormat ?? null,
              sourceId: p.rule.sourceId ?? null,
              sourceContent: p.rule.sourceContent ?? null,
              nativeQuery: p.rule.nativeQuery ?? null,
              nativeLanguage: p.rule.nativeLanguage ?? null,
            },
          });
        }

        if (p.splCommand) {
          await prisma.splCommand.upsert({
            where: { pageId: existing.id },
            create: {
              pageId: existing.id,
              command: p.splCommand.command || '',
              group: p.splCommand.group || '',
              syntax: p.splCommand.syntax || '',
              description: p.splCommand.description || '',
              examples: p.splCommand.examples || '',
              pitfalls: p.splCommand.pitfalls,
              isFavorite: p.splCommand.isFavorite || false,
            },
            update: {
              command: p.splCommand.command || '',
              group: p.splCommand.group || '',
              syntax: p.splCommand.syntax || '',
              description: p.splCommand.description || '',
              examples: p.splCommand.examples || '',
              pitfalls: p.splCommand.pitfalls,
              isFavorite: p.splCommand.isFavorite || false,
            },
          });
        }

        await restoreManualSysmonLinks(existing.id, p.sysmonEvents);
        await restoreTestRuns(existing.id, p.testRuns);
        restored++;
      } else {
        const created = await prisma.page.create({
          data: {
            title: p.title,
            slug: p.slug,
            contentMd: p.contentMd || '',
            type: (p.type as 'NOTE' | 'CONCEPT' | 'DATA_SOURCE' | 'RULE' | 'SPL_COMMAND') || 'NOTE',
            isPinned: p.isPinned || false,
            categoryId,
            tags: {
              create: tagNames
                .filter((n) => tagNameToId.has(n))
                .map((n) => ({ tag: { connect: { id: tagNameToId.get(n)! } } })),
            },
          },
        });

        if (p.rule) {
          await prisma.detectionRule.create({
            data: {
              pageId: created.id,
              status: p.rule.status || 'draft',
              severity: p.rule.severity || 'medium',
              splQuery: p.rule.splQuery || '',
              mitreTactics: p.rule.mitreTactics,
              mitreTechniques: p.rule.mitreTechniques,
              dataSource: p.rule.dataSource,
              falsePositives: p.rule.falsePositives,
              references: p.rule.references,
              testNotes: p.rule.testNotes,
              sigmaId: p.rule.sigmaId ?? null,
              sigmaYaml: p.rule.sigmaYaml ?? null,
              sourceFormat: p.rule.sourceFormat ?? null,
              sourceId: p.rule.sourceId ?? null,
              sourceContent: p.rule.sourceContent ?? null,
              nativeQuery: p.rule.nativeQuery ?? null,
              nativeLanguage: p.rule.nativeLanguage ?? null,
            },
          });
        }

        if (p.splCommand) {
          await prisma.splCommand.create({
            data: {
              pageId: created.id,
              command: p.splCommand.command || '',
              group: p.splCommand.group || '',
              syntax: p.splCommand.syntax || '',
              description: p.splCommand.description || '',
              examples: p.splCommand.examples || '',
              pitfalls: p.splCommand.pitfalls,
              isFavorite: p.splCommand.isFavorite || false,
            },
          });
        }

        await restoreManualSysmonLinks(created.id, p.sysmonEvents);
        await restoreTestRuns(created.id, p.testRuns);
        restored++;
      }
    } catch (e) {
      errors.push(`Page "${p.slug}": ${(e as Error).message}`);
      skipped++;
    }
  }

  for (const st of backup.analyticStories || []) {
    try {
      await saveStoryDetails(
        {
          name: st.name,
          externalId: st.externalId ?? null,
          description: st.description ?? null,
          narrative: st.narrative ?? null,
          references: Array.isArray(st.references) ? st.references.map(String) : [],
          category: st.category ?? null,
          usecase: st.usecase ?? null,
        },
        st.detailsFrom ?? 'backup'
      );
    } catch (e) {
      errors.push(`Analytic story "${st.name}": ${(e as Error).message}`);
    }
  }

  await syncAllDerivedLinks();
  res.json({ restored, skipped, errors });
});

router.delete('/:id', requirePermission('backups:delete'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const log = await prisma.backupLog.findUnique({ where: { id } });

  if (!log) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  const filePath = path.join(BACKUP_DIR, log.fileName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await prisma.backupLog.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
