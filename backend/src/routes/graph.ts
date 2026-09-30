import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { TACTICS, TECHNIQUE_BY_ID, TECHNIQUES, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { LAYERS, filterLayers, findPaths, getGraph, neighbourhood } from '../lib/graph';
import {
  analyzeImpact,
  computeFlows,
  expandLost,
  loadRuleTelemetry,
  loadTelemetryInfo,
  sourceLabel,
  telemetrySource,
} from '../lib/coverage-analysis';
import { REFERENCE_KINDS } from '../lib/references';
import { computeReferenceMatches } from '../lib/references';

const router = Router();

// GET /api/graph?layers=pages,category — nodes and edges of the chosen layers
// (pages, rules, technique, sysmon, logs, tools, tag, category, groups,
// software, mitigations, stories). Default: the wiki
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
    if (!['technique', 'sysmon', 'logevent', 'lolbas', 'gtfobins', 'loldrivers', 'threat-group', 'CONCEPT', 'DATA_SOURCE'].includes(n.group)) continue;
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
// technique (and its sub-techniques): tactics → techniques → rules → telemetry
// (Sysmon and log events) → data sources, plus the attacker tools each rule mentions.
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

  const [rules, dataSources, refs, info] = await Promise.all([
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
            logEvents: { select: { logEvent: { select: { key: true } } } },
          },
        },
      },
    }),
    prisma.page.findMany({
      where: { type: 'DATA_SOURCE' },
      select: {
        id: true,
        title: true,
        slug: true,
        sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } },
        logEvents: { select: { logEvent: { select: { key: true } } } },
      },
    }),
    computeReferenceMatches(),
    loadTelemetryInfo(),
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
  const telemetry = new Map<string, { key: string; label: string; source: string; sourceLabel: string; ruleCount: number }>();
  const out = chainRules.map(({ r, techniques }) => {
    const events = r.page.sysmonEvents.map((s) => s.sysmonEvent);
    const keys = [...events.map((e) => `sysmon:${e.eventId}`), ...r.page.logEvents.map((l) => l.logEvent.key)];
    for (const key of keys) {
      const i = info.get(key);
      const entry = telemetry.get(key) ?? {
        key,
        label: i?.label ?? key,
        source: telemetrySource(key),
        sourceLabel: i?.sourceLabel ?? telemetrySource(key),
        ruleCount: 0,
      };
      entry.ruleCount++;
      telemetry.set(key, entry);
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
      telemetry: keys,
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
    // Sysmon first, then by source and rule count
    telemetry: Array.from(telemetry.values()).sort(
      (a, b) =>
        Number(a.source !== 'sysmon') - Number(b.source !== 'sysmon') ||
        a.sourceLabel.localeCompare(b.sourceLabel) ||
        b.ruleCount - a.ruleCount ||
        a.key.localeCompare(b.key, 'en', { numeric: true })
    ),
    dataSources: dataSources
      .map((d) => ({
        pageId: d.id,
        title: d.title,
        slug: d.slug,
        telemetry: [...d.sysmonEvents.map((s) => `sysmon:${s.sysmonEvent.eventId}`), ...d.logEvents.map((l) => l.logEvent.key)],
      }))
      .filter((d) => d.telemetry.some((k) => telemetry.has(k))),
  });
});

// GET /api/graph/path?from=lolbas:certutil.exe&to=technique:T1105&status=production&links=1
// — shortest paths between two nodes along the detection model's relationships
// (see findPaths). `status`: rule statuses to pass through (default: all but
// deprecated); `links=1`: also follow wiki links.
router.get('/path', async (req, res) => {
  const graph = await getGraph();
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) {
    res.status(404).json({ error: 'Unknown node' });
    return;
  }
  const statuses =
    typeof req.query.status === 'string' && req.query.status
      ? req.query.status
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : null;
  const links = req.query.links === '1' || req.query.links === 'true';
  const opts = { maxPaths: Math.min(Number(req.query.max) || 8, 20), statuses, links };
  const paths = findPaths(graph, from, to, opts);
  // Nothing along the model's relationships: would wiki links connect them?
  const linksWouldHelp = !paths.length && !links && findPaths(graph, from, to, { ...opts, maxPaths: 1, links: true }).length > 0;
  const ids = new Set(paths.flat());
  res.json({
    paths,
    linksWouldHelp,
    nodes: Array.from(ids, (id) => graph.nodes.get(id)!),
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  });
});

// GET /api/graph/impact?sources=sysmon,windows-security&events=sysmon:10,windows-security:4688&dataSource=<pageId>
// — what stops working if that telemetry is lost: whole sources, single events
// (telemetry keys), or every event a data source page lists. sysmon=1,10 is
// shorthand for events=sysmon:1,sysmon:10.
const csv = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

router.get('/impact', async (req, res) => {
  const [rules, info] = await Promise.all([loadRuleTelemetry(), loadTelemetryInfo()]);
  const sources = csv(req.query.sources);
  const events = [...csv(req.query.events), ...csv(req.query.sysmon).filter((n) => /^\d+$/.test(n)).map((n) => `sysmon:${n}`)];
  const dataSourceId = Number(req.query.dataSource);
  if (dataSourceId) {
    const page = await prisma.page.findUnique({
      where: { id: dataSourceId },
      select: { sysmonEvents: { select: { sysmonEvent: { select: { eventId: true } } } }, logEvents: { select: { logEvent: { select: { key: true } } } } },
    });
    for (const l of page?.sysmonEvents ?? []) events.push(`sysmon:${l.sysmonEvent.eventId}`);
    // A data source page naming a whole product ("Elastic Defend") loses the whole source
    for (const l of page?.logEvents ?? []) {
      if (l.logEvent.key.endsWith(':*')) sources.push(telemetrySource(l.logEvent.key));
      else events.push(l.logEvent.key);
    }
  }
  if (!sources.length && !events.length) {
    res.status(400).json({ error: 'Choose at least one log source, event or data source' });
    return;
  }
  const all = new Set(rules.flatMap((r) => r.telemetry));
  const lost = expandLost(all, sources, events);
  const result = analyzeImpact(rules, lost);
  const used = new Set(result.rules.flatMap((r) => r.telemetry));
  res.json({
    sources: Array.from(new Set(sources)).map((s) => ({ key: s, label: sourceLabel(s, info) })),
    events: Array.from(lost).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    labels: Object.fromEntries(Array.from(used, (k) => [k, info.get(k)?.label ?? k])),
    ...result,
  });
});

// GET /api/graph/flows?status=production&tactic=credential-access&groupBy=event —
// detections per (telemetry → tactic) for the Sankey view; with tactic, → techniques.
// groupBy=source (default) draws one node per log source, event one per event.
router.get('/flows', async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status.split(',') : null;
  const source = typeof req.query.source === 'string' && req.query.source ? req.query.source : null;
  const tactic = typeof req.query.tactic === 'string' && req.query.tactic ? req.query.tactic : undefined;
  const groupBy = req.query.groupBy === 'event' ? 'event' : 'source';
  const platform = typeof req.query.telemetry === 'string' && req.query.telemetry ? req.query.telemetry : null;
  if (tactic && !TACTICS.some((t) => t.shortname === tactic)) {
    res.status(404).json({ error: `Unknown tactic ${tactic}` });
    return;
  }
  const info = await loadTelemetryInfo();
  const rules = (await loadRuleTelemetry())
    .filter(
      (r) =>
        (status ? status.includes(r.status) : r.status !== 'deprecated') &&
        (!source || (source === 'manual' ? !r.sourceFormat : r.sourceFormat === source))
    )
    // Only this log source's events (the rules still count once per tactic)
    .map((r) => (platform ? { ...r, telemetry: r.telemetry.filter((k) => telemetrySource(k) === platform) } : r))
    .filter((r) => !platform || r.telemetry.length);
  const withoutTelemetry = req.query.withoutTelemetry !== '0' && req.query.withoutSysmon !== '0';
  const flows = computeFlows(rules, { tactic, withoutTelemetry, groupBy });
  const label = (s: (typeof flows.sources)[number]) => {
    if (s.kind === 'none') return 'No telemetry link';
    if (s.kind === 'source') return sourceLabel(s.key!, info);
    if (s.kind === 'other') return `${sourceLabel(s.key!, info)} · other events`;
    return info.get(s.key!)?.label ?? s.key!;
  };
  res.json({ ...flows, sources: flows.sources.map((s) => ({ ...s, label: label(s) })) });
});

// GET /api/graph/gaps?kind=lolbas — ATT&CK techniques attacker tools are known
// to use, with the tools no rule mentions and the technique's own rule count
router.get('/gaps', async (req, res) => {
  const graph = await getGraph();
  const kind = typeof req.query.kind === 'string' && req.query.kind in REFERENCE_KINDS ? req.query.kind : null;
  const byTechnique = new Map<string, { id: string; name: string; tactics: string[]; rules: number; tools: { id: string; name: string; kind: string; ruleCount: number }[] }>();

  // Rules on a technique, counting a parent's sub-techniques' rules once each
  const rulesOn = (techId: string) => {
    const rules = new Set<string>();
    const ids = techId.includes('.') ? [techId] : TECHNIQUES.filter((t) => t.id === techId || t.id.startsWith(`${techId}.`)).map((t) => t.id);
    for (const id of ids)
      for (const nb of graph.adjacency.get(`technique:${id}`) ?? []) if (graph.nodes.get(nb)?.group === 'RULE') rules.add(nb);
    return rules.size;
  };

  for (const e of graph.edges) {
    if (e.kind !== 'tool-technique') continue;
    const tool = graph.nodes.get(e.source)!;
    if (kind && tool.group !== kind) continue;
    const techId = e.target.slice('technique:'.length);
    if (!byTechnique.has(techId)) {
      const t = TECHNIQUE_BY_ID.get(techId);
      byTechnique.set(techId, { id: techId, name: t?.name ?? techId, tactics: t?.tactics ?? [], rules: rulesOn(techId), tools: [] });
    }
    byTechnique.get(techId)!.tools.push({ id: tool.id, name: tool.label.replace(/ \([^)]+\)$/, ''), kind: tool.group, ruleCount: tool.ruleCount ?? 0 });
  }

  const techniques = Array.from(byTechnique.values()).map((t) => {
    t.tools.sort((a, b) => a.ruleCount - b.ruleCount || a.name.localeCompare(b.name));
    return { ...t, uncoveredTools: t.tools.filter((x) => !x.ruleCount).length };
  });
  const tools = new Map(techniques.flatMap((t) => t.tools.map((x) => [x.id, x] as const)));
  res.json({
    summary: {
      tools: tools.size,
      toolsWithoutRules: Array.from(tools.values()).filter((x) => !x.ruleCount).length,
      techniques: techniques.length,
      techniquesWithoutRules: techniques.filter((t) => !t.rules).length,
    },
    // Techniques with no rule at all first, then most undetected tools
    techniques: techniques.sort((a, b) => Number(!!a.rules) - Number(!!b.rules) || b.uncoveredTools - a.uncoveredTools || a.id.localeCompare(b.id)),
  });
});

export default router;
