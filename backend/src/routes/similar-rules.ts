import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { LIKELY_OVERLAP, loadSimilarGroups } from '../lib/similar-rules';

// Similar rules: groups of active rules with the same techniques and telemetry
// (lib/similar-rules.ts), to merge or retire overlapping detections.

const router = Router();

// GET /api/similar-rules?min=0.5&crossSource=1&q= — groups, most similar first
router.get('/', async (req, res) => {
  const min = Math.min(Math.max(Number(req.query.min) || 0, 0), 1);
  const crossSource = req.query.crossSource === '1';
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const all = await loadSimilarGroups();
  const groups = all.filter(
    (g) =>
      g.similarity >= min &&
      (!crossSource || g.crossSource) &&
      (!q || g.techniques.some((t) => t.toLowerCase() === q) || g.rules.some((r) => r.title.toLowerCase().includes(q)))
  );
  res.json({
    summary: {
      groups: all.length,
      rules: all.reduce((n, g) => n + g.rules.length, 0),
      likely: all.filter((g) => g.similarity >= LIKELY_OVERLAP).length,
      likelyThreshold: LIKELY_OVERLAP,
      crossSource: all.filter((g) => g.crossSource).length,
    },
    matching: groups.length,
    groups: groups.slice(0, 200),
  });
});

// GET /api/similar-rules/compare?a=12&b=34 — two rules side by side
router.get('/compare', async (req, res) => {
  const ids = [Number(req.query.a), Number(req.query.b)];
  if (!ids.every(Number.isInteger)) {
    res.status(400).json({ error: 'Send two page ids' });
    return;
  }
  const rules = await prisma.detectionRule.findMany({
    where: { pageId: { in: ids } },
    select: {
      pageId: true,
      status: true,
      severity: true,
      sourceFormat: true,
      dataSource: true,
      mitreTechniques: true,
      falsePositives: true,
      splQuery: true,
      nativeQuery: true,
      nativeLanguage: true,
      page: { select: { title: true, slug: true, updatedAt: true } },
    },
  });
  const byId = new Map(rules.map((r) => [r.pageId, r]));
  if (ids.some((id) => !byId.has(id))) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  res.json(ids.map((id) => byId.get(id)));
});

export default router;
