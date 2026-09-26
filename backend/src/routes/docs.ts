import { Router } from 'express';
import path from 'path';
import { promises as fsp } from 'fs';
import { prisma } from '../lib/prisma';
import { guard } from '../middleware/auth';
import {
  generateHTMLReport,
  generatePDFReport,
  exportSinglePagePDF,
  exportDetectionMatrix,
  getFileSize,
  type DocPage,
  type DocRule,
} from '../services/docService';

const router = Router();

const MAX_REPORT_ITEMS = 5000;

const toIds = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);

/**
 * The pages and rules a report was asked for. An empty list means none of
 * that kind (it used to mean all of them, so picking only rules also dumped
 * every page into the report).
 */
async function loadReportSelection(rawPageIds: unknown, rawRuleIds: unknown) {
  const pageIds = toIds(rawPageIds);
  const ruleIds = toIds(rawRuleIds);
  if (!pageIds.length && !ruleIds.length) return 'Select at least one page or rule';
  if (pageIds.length + ruleIds.length > MAX_REPORT_ITEMS) return `A report can hold at most ${MAX_REPORT_ITEMS} pages and rules`;
  const [pages, rules] = await Promise.all([
    pageIds.length
      ? prisma.page.findMany({
          where: { id: { in: pageIds } },
          include: { tags: { include: { tag: true } }, splCommand: true },
          orderBy: { title: 'asc' },
        })
      : [],
    ruleIds.length
      ? prisma.detectionRule.findMany({
          where: { id: { in: ruleIds } },
          include: { page: { select: { title: true } } },
          orderBy: { page: { title: 'asc' } },
        })
      : [],
  ]);
  return { pages: pages as DocPage[], rules: rules as unknown as DocRule[] };
}

router.use(guard('docs', { checkReads: true }));

// POST /api/docs/html — generate HTML report
router.post('/html', async (req, res) => {
  const { title = 'Detection Report', pageIds = [], ruleIds = [], includeTableOfContents = true } = req.body as {
    title?: string;
    pageIds?: number[];
    ruleIds?: number[];
    includeTableOfContents?: boolean;
  };

  const selection = await loadReportSelection(pageIds, ruleIds);
  if (typeof selection === 'string') return res.status(400).json({ error: selection });
  const { pages, rules } = selection;

  const filePath = await generateHTMLReport(title, pages, rules, { includeTableOfContents });
  const fileSize = await getFileSize(filePath);

  const doc = await prisma.generatedDoc.create({
    data: {
      title,
      format: 'html',
      filePath,
      fileSize,
      contentSources: { pageIds, ruleIds },
      generatedById: req.user!.userId,
    },
  });

  res.json({ document: doc, downloadUrl: `/api/docs/${doc.id}/download` });
});

// POST /api/docs/pdf — generate PDF report
router.post('/pdf', async (req, res) => {
  const { title = 'Detection Report', pageIds = [], ruleIds = [] } = req.body as {
    title?: string;
    pageIds?: number[];
    ruleIds?: number[];
  };

  const selection = await loadReportSelection(pageIds, ruleIds);
  if (typeof selection === 'string') return res.status(400).json({ error: selection });
  const { pages, rules } = selection;

  const filePath = await generatePDFReport(title, pages, rules);
  const fileSize = await getFileSize(filePath);

  const doc = await prisma.generatedDoc.create({
    data: {
      title,
      format: 'pdf',
      filePath,
      fileSize,
      contentSources: { pageIds, ruleIds },
      generatedById: req.user!.userId,
    },
  });

  res.json({ document: doc, downloadUrl: `/api/docs/${doc.id}/download` });
});

// POST /api/docs/matrix — export detection matrix PDF
router.post('/matrix', async (req, res) => {
  const { title = 'Detection Matrix', tagIds } = req.body as {
    title?: string;
    tagIds?: number[];
  };

  const rules = await prisma.detectionRule.findMany({
    where: tagIds?.length ? { page: { tags: { some: { tagId: { in: tagIds.map(Number) } } } } } : {},
    select: { id: true, status: true, severity: true, mitreTechniques: true, page: { select: { title: true } } },
  });

  const filePath = await exportDetectionMatrix(rules as unknown as DocRule[], title);
  const fileSize = await getFileSize(filePath);

  const doc = await prisma.generatedDoc.create({
    data: {
      title,
      format: 'pdf',
      filePath,
      fileSize,
      contentSources: { tagIds },
      generatedById: req.user!.userId,
    },
  });

  res.json({ document: doc, downloadUrl: `/api/docs/${doc.id}/download` });
});

// GET /api/docs/page/:slug/pdf — export single page as PDF
router.get('/page/:slug/pdf', async (req, res) => {
  const page = await prisma.page.findUnique({
    where: { slug: req.params.slug },
    include: {
      tags: { include: { tag: true } },
      splCommand: true,
      rule: true,
    },
  });
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  const filePath = await exportSinglePagePDF(page as unknown as DocPage);
  const fileSize = await getFileSize(filePath);

  const doc = await prisma.generatedDoc.create({
    data: {
      title: page.title,
      format: 'pdf',
      filePath,
      fileSize,
      contentSources: { pageIds: [page.id] },
      generatedById: req.user!.userId,
    },
  });

  res.json({ document: doc, downloadUrl: `/api/docs/${doc.id}/download` });
});

// GET /api/docs — list generated documents
router.get('/', async (req, res) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.roles.includes('admin');

  const docs = await prisma.generatedDoc.findMany({
    where: isAdmin
      ? undefined
      : { OR: [{ generatedById: userId ?? null }, { generatedById: null }, { isPublic: true }] },
    orderBy: { generatedAt: 'desc' },
    take: 100,
    include: { generatedBy: { select: { username: true } } },
  });

  res.json(docs);
});

// GET /api/docs/:id/download — download a generated document
router.get('/:id/download', async (req, res) => {
  const id = parseInt(req.params.id);
  const doc = await prisma.generatedDoc.findUnique({ where: { id } });

  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const userId = req.user!.userId;
  const isAdmin = req.user!.roles.includes('admin');
  // Allow: admin, public doc, own doc, or unowned doc (generatedById null = created with old token)
  const canAccess = isAdmin || doc.isPublic || doc.generatedById === null || doc.generatedById === userId;
  if (!canAccess) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    await fsp.access(doc.filePath);
  } catch {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  const ext = path.extname(doc.filePath).slice(1);
  const contentType = ext === 'pdf' ? 'application/pdf' : 'text/html';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(doc.filePath)}"`);
  res.sendFile(doc.filePath);
});

// DELETE /api/docs/:id — delete document
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const doc = await prisma.generatedDoc.findUnique({ where: { id } });

  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const userId = req.user!.userId;
  const isAdmin = req.user!.roles.includes('admin');
  if (!isAdmin && doc.generatedById !== null && doc.generatedById !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try { await fsp.unlink(doc.filePath); } catch { /* file may not exist */ }
  await prisma.generatedDoc.delete({ where: { id } });

  res.json({ message: 'Document deleted' });
});

export default router;
