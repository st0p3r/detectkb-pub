import { Router, Request } from 'express';
import multer from 'multer';
import { kbCacheMap } from '../lib/kb-cache';
import { requirePermission } from '../middleware/auth';
import { attackDataInfo, downloadAttackBundle, importAttackBundle, resetAttackData } from '../lib/attack-update';
import { prisma } from '../lib/prisma';
import {
  ATTACK_VERSION,
  TACTICS,
  TECHNIQUES,
  parentTechniqueId,
  parseTechniqueIds,
  resolveTechniqueId,
} from '../lib/attack';
import { ValidationStatus, loadValidation } from '../lib/validation';
import { CONFIDENCE_LEVELS, CoverageConfidence, bestConfidence } from '../lib/coverage-confidence';

const router = Router();
const canManage = requirePermission('settings:manage');
// enterprise-attack.json is ~55 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// GET /api/attack/data — the ATT&CK release in use and where it came from
router.get('/data', async (_req, res) => {
  res.json(await attackDataInfo());
});

// POST /api/attack/data/download — import MITRE's current Enterprise release
router.post('/data/download', canManage, async (req, res) => {
  try {
    res.json(await downloadAttackBundle(req.user?.userId ?? null));
  } catch (err) {
    // No internet, a proxy, or a changed URL: say what happened
    const e = err as Error & { status?: number };
    console.warn(`[attack] download failed: ${e.message}`);
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: `Could not download ATT&CK data: ${e.message}` });
  }
});

// POST /api/attack/data/upload (multipart "file": enterprise-attack.json) — for servers without internet
router.post('/data/upload', canManage, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Choose enterprise-attack.json' });
    return;
  }
  let bundle: unknown;
  try {
    bundle = JSON.parse(req.file.buffer.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'The file is not JSON' });
    return;
  }
  try {
    res.json(await importAttackBundle(bundle, `upload: ${req.file.originalname}`.slice(0, 500), req.user?.userId ?? null, req.body?.allowOlder === 'true'));
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 400).json({ error: e.message });
  }
});

// POST /api/attack/data/reset — go back to the release bundled with DetectKB
router.post('/data/reset', canManage, async (_req, res) => {
  res.json({ ruleMappings: await resetAttackData(), ...(await attackDataInfo()) });
});

interface CoveringRule {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  /** Lab validation status (lib/validation) */
  validation: ValidationStatus;
}

/** ?status=production,testing — defaults to every status except deprecated. */
function statusFilter(raw: string) {
  if (raw === 'all') return {};
  if (raw) return { status: { in: raw.split(',').map((s) => s.trim()).filter(Boolean) } };
  return { status: { not: 'deprecated' } };
}

// Coverage per filter (cached until data changes; shared, so read-only)
const coverageCache = kbCacheMap(
  (key) => {
    const [status, validation] = key.split('|');
    return buildCoverage(status, validation === 'validated');
  },
  { warm: true, label: 'ATT&CK coverage' }
);

/** technique ID → rules that reference it, for ?status= and ?validation=validated */
function computeCoverage(req: Request) {
  const raw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const status = raw === 'all' ? raw : raw.split(',').map((s) => s.trim()).filter(Boolean).sort().join(',');
  return coverageCache.get(`${status}|${req.query.validation === 'validated' ? 'validated' : ''}`);
}

/** technique ID → rules that reference it (IDs not in ATT&CK are returned separately). */
async function buildCoverage(status: string, onlyValidated: boolean) {
  // ?validation=validated — proven coverage: only rules a lab test showed firing
  const validation = await loadValidation();
  const all = await prisma.detectionRule.findMany({
    where: statusFilter(status),
    select: {
      status: true,
      severity: true,
      mitreTechniques: true,
      page: { select: { id: true, title: true, slug: true } },
    },
  });
  const rules = onlyValidated ? all.filter((r) => validation(r.page.id).status === 'validated') : all;

  const byTechnique = new Map<string, CoveringRule[]>();
  const unknown = new Map<string, CoveringRule[]>();
  // Retired IDs still used by rules, e.g. T1562.001 → T1685
  const retired = new Map<string, { replacedBy: string; rules: CoveringRule[] }>();
  for (const r of rules) {
    const info: CoveringRule = {
      pageId: r.page.id,
      title: r.page.title,
      slug: r.page.slug,
      status: r.status,
      severity: r.severity,
      validation: validation(r.page.id).status,
    };
    for (const rawId of parseTechniqueIds(r.mitreTechniques)) {
      const id = resolveTechniqueId(rawId);
      if (!id) {
        if (!unknown.has(rawId)) unknown.set(rawId, []);
        unknown.get(rawId)!.push(info);
        continue;
      }
      if (id !== rawId) {
        if (!retired.has(rawId)) retired.set(rawId, { replacedBy: id, rules: [] });
        retired.get(rawId)!.rules.push(info);
      }
      if (!byTechnique.has(id)) byTechnique.set(id, []);
      const list = byTechnique.get(id)!;
      if (!list.some((x) => x.pageId === info.pageId)) list.push(info);
    }
  }
  return { ruleCount: rules.length, byTechnique, unknown, retired };
}

// GET /api/attack/coverage — ATT&CK matrix with rule counts per technique.
// The rules themselves come from /techniques/:id/rules when a cell is opened
// (sending every covering rule made this ~700 KB).
router.get('/coverage', async (req, res) => {
  const { ruleCount, byTechnique, unknown, retired } = await computeCoverage(req);

  const coveredParents = new Set(Array.from(byTechnique.keys()).map(parentTechniqueId));
  const parentTotal = TECHNIQUES.filter((t) => !t.id.includes('.')).length;

  // Parent cell = rules on the technique or any sub-technique, each rule once
  const parentRules = new Map<string, Map<number, CoveringRule>>();
  for (const [id, rules] of byTechnique) {
    const parent = parentTechniqueId(id);
    if (!parentRules.has(parent)) parentRules.set(parent, new Map());
    for (const r of rules) parentRules.get(parent)!.set(r.pageId, r);
  }
  // Best confidence per technique and per parent cell, and how many covered
  // (parent) techniques reach each level
  const confidence = Object.fromEntries(Array.from(byTechnique, ([id, rules]) => [id, bestConfidence(rules)]));
  const parentConfidence = Object.fromEntries(Array.from(parentRules, ([id, rules]) => [id, bestConfidence(rules.values())]));
  const confidenceCounts = Object.fromEntries(CONFIDENCE_LEVELS.map((l) => [l, 0])) as Record<CoverageConfidence, number>;
  for (const level of Object.values(parentConfidence)) if (level) confidenceCounts[level]++;

  res.json({
    attackVersion: ATTACK_VERSION,
    tactics: TACTICS,
    techniques: TECHNIQUES,
    counts: Object.fromEntries(Array.from(byTechnique, ([id, rules]) => [id, rules.length])),
    parentCounts: Object.fromEntries(Array.from(parentRules, ([id, rules]) => [id, rules.size])),
    confidence,
    parentConfidence,
    unknownTechniques: Array.from(unknown, ([id, rules]) => ({ id, rules })),
    retiredTechniques: Array.from(retired, ([id, v]) => ({ id, ...v })),
    summary: {
      rulesAnalyzed: ruleCount,
      coveredTechniques: coveredParents.size,
      totalTechniques: parentTotal,
      confidence: confidenceCounts,
    },
  });
});

// GET /api/attack/techniques/T1003/rules?status= — the rules covering a
// technique and each of its sub-techniques: { "T1003": [...], "T1003.001": [...] }
router.get('/techniques/:id/rules', async (req, res) => {
  const parent = parentTechniqueId(req.params.id.toUpperCase());
  const { byTechnique } = await computeCoverage(req);
  res.json(Object.fromEntries(Array.from(byTechnique).filter(([id]) => parentTechniqueId(id) === parent)));
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
