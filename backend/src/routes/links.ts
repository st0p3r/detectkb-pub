import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/broken', async (_req, res) => {
  // Fetch all pages with their content
  const pages = await prisma.page.findMany({
    select: { id: true, slug: true, title: true, contentMd: true },
  });

  // Build a set of all page titles (lowercase) for fast lookup
  const titleToSlug = new Map<string, string>();
  for (const p of pages) {
    titleToSlug.set(p.title.toLowerCase(), p.slug);
  }

  const regex = /\[\[([^\]]+)\]\]/g;
  const broken: { sourceSlug: string; sourceTitle: string; brokenTitle: string }[] = [];

  for (const page of pages) {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    const r = new RegExp(regex.source, 'g');
    while ((m = r.exec(page.contentMd)) !== null) {
      const title = m[1].trim();
      const key = title.toLowerCase();
      if (!titleToSlug.has(key) && !seen.has(key)) {
        seen.add(key);
        broken.push({ sourceSlug: page.slug, sourceTitle: page.title, brokenTitle: title });
      }
    }
  }

  res.json(broken);
});

export default router;
