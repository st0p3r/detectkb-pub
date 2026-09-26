import { Router, Request } from 'express';
import { prisma } from '../lib/prisma';
import {
  ATTACK_VERSION,
  TACTICS,
  TECHNIQUES,
  TECHNIQUE_BY_ID,
  parentTechniqueId,
  parseTechniqueIds,
} from '../lib/attack';

const router = Router();

interface CoveringRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
}

/** ?status=production,testing — defaults to every status except deprecated. */
function statusFilter(req: Request) {
  const raw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (raw === 'all') return {};
  if (raw) return { status: { in: raw.split(',').map((s) => s.trim()).filter(Boolean) } };
  return { status: { not: 'deprecated' } };
}

/** technique ID → rules that reference it (IDs not in ATT&CK are returned separately). */
async function computeCoverage(req: Request) {
  const rules = await prisma.detectionRule.findMany({
    where: statusFilter(req),
    select: {
      status: true,
      severity: true,
      mitreTechniques: true,
      page: { select: { id: true, title: true, slug: true } },
    },
  });

  const byTechnique = new Map<string, CoveringRule[]>();
  const unknown = new Map<string, CoveringRule[]>();
  for (const r of rules) {
    const info: CoveringRule = {
      pageId: r.page.id,
      title: r.page.title,
      slug: r.page.slug,
      status: r.status,
      severity: r.severity,
    };
    for (const id of parseTechniqueIds(r.mitreTechniques)) {
      const target = TECHNIQUE_BY_ID.has(id) ? byTechnique : unknown;
      if (!target.has(id)) target.set(id, []);
      target.get(id)!.push(info);
    }
  }
  return { ruleCount: rules.length, byTechnique, unknown };
}

// GET /api/attack/coverage — ATT&CK matrix with the rules covering each technique
router.get('/coverage', async (req, res) => {
  const { ruleCount, byTechnique, unknown } = await computeCoverage(req);

  const coveredParents = new Set(Array.from(byTechnique.keys()).map(parentTechniqueId));
  const parentTotal = TECHNIQUES.filter((t) => !t.id.includes('.')).length;

  res.json({
    attackVersion: ATTACK_VERSION,
    tactics: TACTICS,
    techniques: TECHNIQUES,
    coverage: Object.fromEntries(byTechnique),
    unknownTechniques: Array.from(unknown, ([id, rules]) => ({ id, rules })),
    summary: {
      rulesAnalyzed: ruleCount,
      coveredTechniques: coveredParents.size,
      totalTechniques: parentTotal,
    },
  });
});

// GET /api/attack/navigator-layer — ATT&CK Navigator layer (v4.5) as a download
router.get('/navigator-layer', async (req, res) => {
  const { byTechnique } = await computeCoverage(req);

  const techniques = Array.from(byTechnique, ([id, rules]) => ({
    techniqueID: id,
    score: rules.length,
    comment: rules.map((r) => `${r.title} [${r.status}/${r.severity}]`).join('\n'),
    enabled: true,
    showSubtechniques: false,
  }));
  // Expand parents whose sub-techniques are covered so they're visible in Navigator
  const parentsWithSubs = new Set(
    techniques.filter((t) => t.techniqueID.includes('.')).map((t) => parentTechniqueId(t.techniqueID))
  );
  for (const parentId of parentsWithSubs) {
    const parent = techniques.find((t) => t.techniqueID === parentId);
    if (parent) parent.showSubtechniques = true;
    else techniques.push({ techniqueID: parentId, score: 0, comment: '', enabled: true, showSubtechniques: true });
  }

  const maxScore = Math.max(1, ...techniques.map((t) => t.score));
  const layer = {
    name: 'DetectKB coverage',
    versions: { attack: ATTACK_VERSION?.split('.')[0] ?? '16', navigator: '5.1.0', layer: '4.5' },
    domain: 'enterprise-attack',
    description: `Detection coverage exported from DetectKB on ${new Date().toISOString().slice(0, 10)}. Score = number of rules.`,
    filters: { platforms: ['Windows', 'Linux', 'macOS', 'Network', 'PRE', 'Containers', 'IaaS', 'SaaS', 'Office Suite', 'Identity Provider', 'ESXi'] },
    sorting: 0,
    layout: { layout: 'side', aggregateFunction: 'max', showID: true, showName: true, showAggregateScores: true, countUnscored: false },
    hideDisabled: false,
    techniques,
    gradient: { colors: ['#e0f2fe', '#38bdf8', '#1d4ed8'], minValue: 0, maxValue: maxScore },
    legendItems: [],
    metadata: [],
    links: [],
    showTacticRowBackground: false,
    tacticRowBackground: '#dddddd',
    selectTechniquesAcrossTactics: true,
    selectSubtechniquesWithParent: false,
    selectVisibleTechniques: false,
  };

  res.setHeader('Content-Disposition', 'attachment; filename="detectkb-attack-layer.json"');
  res.json(layer);
});

export default router;
