import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { TACTICS, TECHNIQUE_BY_ID, TECHNIQUES, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { LAYERS, filterLayers, getGraph, neighbourhood } from '../lib/graph';
import { computeReferenceMatches } from '../lib/references';

const router = Router();

// GET /api/graph?layers=pages,category — nodes and edges of the chosen layers
// (pages, rules, technique, sysmon, tools, tag, category). Default: the wiki
// view — knowledge pages and their [[links]].
router.get('/', async (req, res) => {
  const requested = typeof req.query.layers === 'string' ? req.query.layers.split(',') : ['pages', 'category'];
  const layers = requested.filter((l) => l in LAYERS);
  res.json(filterLayers(await getGraph(), layers.length ? layers : ['pages']));
});

// GET /api/graph/search?q= — nodes to start exploring from
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (!q) {
    res.json([]);
    return;
  }
  const nodes = Array.from((await getGraph()).nodes.values())
    .filter((n) => n.label.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || b.degree - a.degree)
    .slice(0, 12);
  res.json(nodes);
});

// GET /api/graph/hubs — most connected nodes per group, as starting points
router.get('/hubs', async (_req, res) => {
  const byGroup = new Map<string, { id: string; label: string; group: string; degree: number }[]>();
  for (const n of (await getGraph()).nodes.values()) {
    if (!['technique', 'sysmon', 'lolbas', 'gtfobins', 'loldrivers', 'CONCEPT', 'DATA_SOURCE'].includes(n.group)) continue;
    if (!byGroup.has(n.group)) byGroup.set(n.group, []);
    byGroup.get(n.group)!.push(n);
  }
  res.json(
    Array.from(byGroup.values()).flatMap((list) =>
      list.sort((a, b) => b.degree - a.degree).slice(0, 4).map(({ id, label, group, degree }) => ({ id, label, group, degree }))
    )
  );
});

// GET /api/graph/node?id=technique:T1003&group=RULE&offset=12&limit=50 — a node's neighbours
router.get('/node', async (req, res) => {
  const id = String(req.query.id ?? '');
  const result = neighbourhood(await getGraph(), id, {
    group: typeof req.query.group === 'string' ? req.query.group : undefined,
    offset: Number(req.query.offset) || 0,
    limit: Number(req.query.limit) || undefined,
  });
  if (!result) {
    res.status(404).json({ error: 'Node not found' });
    return;
  }
  res.json(result);
});

// GET /api/graph/chain?technique=T1003&status=production — the detection chain of a
// technique (and its sub-techniques): tactics → techniques → rules → Sysmon events
// → data sources, plus the attacker tools each rule mentions.
router.get('/chain', async (req, res) => {
  const requested = String(req.query.technique ?? '').toUpperCase();
  const techId = resolveTechniqueId(requested);
  if (!techId) {
    res.status(404).json({ error: `Unknown technique ${requested}` });
    return;
  }
  const parentId = techId.split('.')[0];
  const scope = techId.includes('.') ? [techId] : TECHNIQUES.filter((t) => t.id === parentId || t.id.startsWith(`${parentId}.`)).map((t) => t.id);
  const inScope = new Set(scope);
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.split(',') : null;

  const [rules, dataSources, refs] = await Promise.all([
    prisma.detectionRule.findMany({
      where: status ? { status: { in: status } } : { status: { not: 'deprecated' } },
      select: {
        status: true,
        severity: true,
        sourceFormat: true,
        dataSource: true,
        mitreTechniques: true,
        page: {
          select: {
            id: true,
            title: true,
            slug: true,
            sysmonEvents: { select: { sysmonEvent: { select: { eventId: true, name: true } } } },
          },
        },
      },
    }),
    prisma.page.findMany({
      where: { type: 'DATA_SOURCE' },
      select: { id: true, title: true, slug: true, sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } } },
    }),
    computeReferenceMatches(),
  ]);

  const chainRules = rules
    .map((r) => {
      const techniques = Array.from(
        new Set(parseTechniqueIds(r.mitreTechniques).map(resolveTechniqueId).filter((t): t is string => !!t && inScope.has(t)))
      );
      return { r, techniques };
    })
    .filter(({ techniques }) => techniques.length);

  const refKeys = new Map<number, { kind: string; key: string }[]>();
  for (const { r } of chainRules) refKeys.set(r.page.id, refs.byPage.get(r.page.id) ?? []);
  const sysmon = new Map<number, { eventId: number; name: string; ruleCount: number }>();
  const out = chainRules.map(({ r, techniques }) => {
    const events = r.page.sysmonEvents.map((s) => s.sysmonEvent);
    for (const e of events) {
      const entry = sysmon.get(e.eventId) ?? { eventId: e.eventId, name: e.name, ruleCount: 0 };
      entry.ruleCount++;
      sysmon.set(e.eventId, entry);
    }
    return {
      pageId: r.page.id,
      title: r.page.title,
      slug: r.page.slug,
      status: r.status,
      severity: r.severity,
      sourceFormat: r.sourceFormat,
      dataSource: r.dataSource,
      techniques,
      sysmon: events.map((e) => e.eventId).sort((a, b) => a - b),
      tools: (refKeys.get(r.page.id) ?? []).map((x) => ({ kind: x.kind, key: x.key, name: refs.names.get(`${x.kind}:${x.key}`) ?? x.key })),
    };
  });

  const ruleCount = (id: string) => out.filter((r) => r.techniques.includes(id)).length;
  const parent = TECHNIQUE_BY_ID.get(parentId)!;
  res.json({
    technique: { id: techId, name: TECHNIQUE_BY_ID.get(techId)!.name },
    tactics: TACTICS.filter((t) => parent.tactics.includes(t.shortname)),
    techniques: scope.map((id) => ({ id, name: TECHNIQUE_BY_ID.get(id)!.name, ruleCount: ruleCount(id) })),
    rules: out,
    sysmon: Array.from(sysmon.values()).sort((a, b) => a.eventId - b.eventId),
    dataSources: dataSources
      .map((d) => ({ pageId: d.id, title: d.title, slug: d.slug, sysmon: d.sysmonEvents.map((s) => s.sysmonEvent.eventId) }))
      .filter((d) => d.sysmon.some((id) => sysmon.has(id))),
  });
});

export default router;
