import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/search?q=<term>
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ pages: [], rules: [], splCommands: [] });

  const [pages, rules, splCommands] = await Promise.all([
    prisma.page.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { contentMd: { contains: q } },
        ],
      },
      select: { id: true, title: true, slug: true, type: true, contentMd: true, updatedAt: true },
      take: 20,
    }),
    prisma.detectionRule.findMany({
      where: { OR: [{ splQuery: { contains: q } }, { page: { title: { contains: q } } }] },
      include: { page: { select: { title: true, slug: true } } },
      take: 10,
    }),
    prisma.splCommand.findMany({
      where: { OR: [{ command: { contains: q } }, { description: { contains: q } }] },
      include: { page: { select: { title: true, slug: true } } },
      take: 10,
    }),
  ]);

  const snippet = (text: string) => {
    if (!text) return '';
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.slice(0, 150) + '...';
    const start = Math.max(0, idx - 60);
    return (start > 0 ? '...' : '') + text.slice(start, start + 200) + '...';
  };

  res.json({
    pages: pages.map((p) => ({ ...p, snippet: snippet(p.contentMd || '') })),
    rules: rules.map((r) => ({
      id: r.id,
      title: r.page.title,
      slug: r.page.slug,
      type: 'RULE',
      snippet: snippet(r.splQuery),
    })),
    splCommands: splCommands.map((s) => ({
      id: s.id,
      title: s.command,
      slug: s.page.slug,
      type: 'SPL_COMMAND',
      snippet: snippet(s.description),
    })),
  });
});

export default router;
