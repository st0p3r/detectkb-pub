import { Router, Request } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/auth';
import { attackDataInfo, downloadAttackBundle, importAttackBundle, resetAttackData } from '../lib/attack-update';
import { ATTACK_VERSION, TACTICS, TECHNIQUES, attackPlatforms, onPlatforms, parentTechniqueId } from '../lib/attack';
import { loadCoverage, summarizeCoverage } from '../lib/attack-coverage';
import { loadHistory, takeSnapshot } from '../lib/coverage-snapshot';

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

/** ?status=, ?validation=validated, ?logs=collected → the coverage for those filters */
function computeCoverage(req: Request) {
  return loadCoverage({
    status: typeof req.query.status === 'string' ? req.query.status.trim() : '',
    validated: req.query.validation === 'validated',
    withLogs: req.query.logs === 'collected',
  });
}

/** ?platforms=Windows,Linux → the platforms to limit the matrix to (null: all) */
function platformFilter(req: Request): Set<string> | null {
  const known = new Set(attackPlatforms());
  const chosen = String(req.query.platforms ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => known.has(p));
  return chosen.length ? new Set(chosen) : null;
}

// GET /api/attack/coverage — ATT&CK matrix with rule counts per technique.
// The rules themselves come from /techniques/:id/rules when a cell is opened
// (sending every covering rule made this ~700 KB).
//   ?platforms=Windows,Linux  only techniques on those platforms (counts and totals)
//   ?logs=collected           leave out rules whose logs aren't collected
router.get('/coverage', async (req, res) => {
  const { ruleCount, blindRules, collectionActive, byTechnique, unknown, retired } = await computeCoverage(req);
  const platforms = platformFilter(req);
  const s = summarizeCoverage(byTechnique, platforms);

  res.json({
    attackVersion: ATTACK_VERSION,
    tactics: TACTICS,
    techniques: TECHNIQUES.filter((t) => onPlatforms(t.id, platforms) && onPlatforms(parentTechniqueId(t.id), platforms)),
    platforms: attackPlatforms(),
    counts: s.counts,
    parentCounts: s.parentCounts,
    confidence: s.confidence,
    parentConfidence: s.parentConfidence,
    parentBlind: s.parentBlind,
    unknownTechniques: Array.from(unknown, ([id, rules]) => ({ id, rules })),
    retiredTechniques: Array.from(retired, ([id, v]) => ({ id, ...v })),
    summary: {
      rulesAnalyzed: ruleCount,
      coveredTechniques: s.coveredTechniques,
      totalTechniques: s.totalTechniques,
      confidence: s.confidenceCounts,
      /** Whether anyone said which logs are collected (Log Sources) */
      collectionActive,
      /** Matching rules that can't fire: their logs aren't collected */
      blindRules,
      /** Covered techniques whose every rule is blind */
      blindTechniques: s.blindTechniques,
    },
  });
});

// GET /api/attack/coverage/history?days=180 — daily snapshots of the headline numbers
router.get('/coverage/history', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 180, 7), 1100);
  res.json(await loadHistory(days));
});

// POST /api/attack/coverage/snapshot — store today's numbers now
router.post('/coverage/snapshot', requirePermission('rules:update'), async (_req, res) => {
  res.json(await takeSnapshot());
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
  const platforms = platformFilter(req);

  const techniques = Array.from(byTechnique)
    .filter(([id]) => onPlatforms(id, platforms))
    .map(([id, rules]) => ({
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
    filters: { platforms: platforms ? Array.from(platforms) : attackPlatforms() },
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
