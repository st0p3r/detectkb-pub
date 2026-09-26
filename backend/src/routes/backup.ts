import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { BACKUP_DIR } from '../lib/config';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Every backup endpoint (including list/download) exposes the full dataset,
// so none of them are public.
router.use(authMiddleware);

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
      },
    }),
    prisma.category.findMany(),
    prisma.tag.findMany(),
  ]);

  const backup = { version: 1, exportedAt: new Date().toISOString(), pages, categories, tags };
  const timestamp = Date.now();
  const fileName = `detectkb-backup-${timestamp}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);

  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
  const sizeBytes = fs.statSync(filePath).size;

  await prisma.backupLog.create({ data: { fileName, sizeBytes, type: 'json' } });

  return { fileName, sizeBytes, downloadUrl: `/api/backup/download/${fileName}` };
}

router.post('/json', async (_req: Request, res: Response) => {
  const result = await runJsonBackup();
  res.json(result);
});

router.get('/list', async (_req: Request, res: Response) => {
  const logs = await prisma.backupLog.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(logs);
});

router.get('/download/:fileName', (req: Request, res: Response) => {
  const safe = req.params.fileName.replace(/[^a-zA-Z0-9\-_.]/g, '');
  const filePath = path.join(BACKUP_DIR, safe);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(filePath, safe);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/restore/json', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  let backup: {
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
      } | null;
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

        restored++;
      }
    } catch (e) {
      errors.push(`Page "${p.slug}": ${(e as Error).message}`);
      skipped++;
    }
  }

  res.json({ restored, skipped, errors });
});

router.delete('/:id', async (req: Request, res: Response) => {
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
