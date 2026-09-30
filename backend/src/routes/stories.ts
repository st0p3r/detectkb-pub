import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { STORY_REPO_RAW, fetchStoryDetails, importStoryFiles } from '../lib/stories';

// Splunk analytic stories: the scenarios ESCU detections belong to.

const router = Router();

// GET /api/stories?q= — every story with rule counts
router.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const stories = await prisma.analyticStory.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {},
    select: {
      id: true,
      name: true,
      category: true,
      usecase: true,
      description: true,
      rules: { select: { page: { select: { rule: { select: { status: true, mitreTechniques: true } } } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json({
    source: STORY_REPO_RAW,
    stories: stories.map((s) => {
      const rules = s.rules.map((r) => r.page.rule).filter((r): r is NonNullable<typeof r> => !!r);
      const active = rules.filter((r) => r.status !== 'deprecated');
      const techniques = new Set(active.flatMap((r) => parseTechniqueIds(r.mitreTechniques).map(resolveTechniqueId).filter(Boolean)));
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        usecase: s.usecase,
        description: s.description,
        hasDetails: !!s.description,
        rules: rules.length,
        activeRules: active.length,
        production: rules.filter((r) => r.status === 'production').length,
        techniques: techniques.size,
      };
    }),
  });
});

// GET /api/stories/:id — a story with its rules and the techniques they cover
router.get('/:id', async (req, res) => {
  const story = await prisma.analyticStory.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      rules: {
        select: {
          page: { select: { id: true, title: true, slug: true, rule: { select: { status: true, severity: true, mitreTechniques: true } } } },
        },
        orderBy: { page: { title: 'asc' } },
      },
    },
  });
  if (!story) {
    res.status(404).json({ error: 'Story not found' });
    return;
  }
  const rules = story.rules
    .filter((r) => r.page.rule)
    .map(({ page: { rule, ...page } }) => ({
      pageId: page.id,
      title: page.title,
      slug: page.slug,
      status: rule!.status,
      severity: rule!.severity,
      techniques: Array.from(new Set(parseTechniqueIds(rule!.mitreTechniques).map(resolveTechniqueId).filter((t): t is string => !!t))),
    }));
  const techniques = new Map<string, { id: string; name: string; rules: number; activeRules: number }>();
  for (const r of rules) {
    for (const t of r.techniques) {
      const e = techniques.get(t) ?? { id: t, name: TECHNIQUE_BY_ID.get(t)?.name ?? t, rules: 0, activeRules: 0 };
      e.rules++;
      if (r.status !== 'deprecated') e.activeRules++;
      techniques.set(t, e);
    }
  }
  const { rules: _links, ...details } = story;
  res.json({
    ...details,
    references: Array.isArray(story.references) ? story.references : [],
    rules,
    techniques: Array.from(techniques.values()).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
    statusCounts: rules.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
  });
});

// POST /api/stories/import — { files: [{ name, content }] } story YAML files (stories/*.yml)
router.post('/import', requirePermission('rules:create'), async (req, res) => {
  const files = (req.body?.files ?? []) as { name?: unknown; content?: unknown }[];
  if (!Array.isArray(files) || !files.length) {
    res.status(400).json({ error: 'No files' });
    return;
  }
  const valid = files.filter((f) => typeof f.name === 'string' && typeof f.content === 'string') as { name: string; content: string }[];
  res.json(await importStoryFiles(valid));
});

// POST /api/stories/fetch — { all?: boolean } download story details from splunk/security_content
router.post('/fetch', requirePermission('rules:create'), async (req, res) => {
  res.json(await fetchStoryDetails({ all: req.body?.all === true }));
});

export default router;
