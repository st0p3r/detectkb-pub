import { Router, Request } from 'express';
import { TECHNIQUE_BY_ID, parentTechniqueId, resolveTechniqueId } from '../lib/attack';
import {
  GROUPS,
  GROUPS_BY_TECHNIQUE,
  GROUP_BY_ID,
  MITIGATIONS_BY_TECHNIQUE,
  SOFTWARE,
  SOFTWARE_BY_ID,
  SOFTWARE_BY_TECHNIQUE,
  actorCoverage,
  attackObjectUrl,
} from '../lib/attack-cti';
import { loadRuleTelemetry } from '../lib/coverage-analysis';
import { getD3fend } from '../lib/d3fend';

// ATT&CK threat groups and software, and how well the rules cover the
// techniques each one uses; per-technique mitigations, D3FEND countermeasures
// and the groups / software known to use it.

const router = Router();

/** ?status=production,testing | all — default: every status except deprecated. */
async function rulesByTechnique(req: Request): Promise<Map<string, Set<number>>> {
  const raw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const statuses = raw && raw !== 'all' ? raw.split(',').map((s) => s.trim()) : null;
  const out = new Map<string, Set<number>>();
  for (const r of await loadRuleTelemetry()) {
    if (statuses ? !statuses.includes(r.status) : raw !== 'all' && r.status === 'deprecated') continue;
    for (const t of r.techniques) {
      if (!out.has(t)) out.set(t, new Set());
      out.get(t)!.add(r.pageId);
    }
  }
  return out;
}

const matches = (q: string, ...fields: (string | string[])[]) =>
  !q || fields.flat().some((f) => f.toLowerCase().includes(q));

// GET /api/threat-intel/groups?q=&status= — groups with their coverage
router.get('/groups', async (req, res) => {
  const byTech = await rulesByTechnique(req);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const groups = GROUPS.filter((g) => matches(q, g.id, g.name, g.aliases)).map((g) => {
    const { total, covered, parentOnly, pct } = actorCoverage(g.techniques, byTech);
    return { id: g.id, name: g.name, aliases: g.aliases, total, covered, parentOnly, pct, software: g.software.length };
  });
  res.json(groups);
});

// GET /api/threat-intel/groups/G0049?status= — a group, the coverage of each technique it uses, its software
router.get('/groups/:id', async (req, res) => {
  const g = GROUP_BY_ID.get(req.params.id.toUpperCase());
  if (!g) {
    res.status(404).json({ error: 'Unknown group' });
    return;
  }
  const byTech = await rulesByTechnique(req);
  res.json({
    ...g,
    url: attackObjectUrl(g.id),
    coverage: actorCoverage(g.techniques, byTech),
    software: g.software
      .map((id) => SOFTWARE_BY_ID.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ id: s.id, name: s.name, type: s.type, ...pick(actorCoverage(s.techniques, byTech)) })),
  });
});

const pick = ({ total, covered, parentOnly, pct }: ReturnType<typeof actorCoverage>) => ({ total, covered, parentOnly, pct });

// GET /api/threat-intel/software?q=&type=malware|tool&status= — software with coverage
router.get('/software', async (req, res) => {
  const byTech = await rulesByTechnique(req);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const type = req.query.type === 'malware' || req.query.type === 'tool' ? req.query.type : null;
  res.json(
    SOFTWARE.filter((s) => (!type || s.type === type) && matches(q, s.id, s.name, s.aliases)).map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      aliases: s.aliases,
      platforms: s.platforms,
      ...pick(actorCoverage(s.techniques, byTech)),
    }))
  );
});

// GET /api/threat-intel/software/S0002?status= — software, its techniques' coverage, groups using it
router.get('/software/:id', async (req, res) => {
  const s = SOFTWARE_BY_ID.get(req.params.id.toUpperCase());
  if (!s) {
    res.status(404).json({ error: 'Unknown software' });
    return;
  }
  const byTech = await rulesByTechnique(req);
  res.json({
    ...s,
    url: attackObjectUrl(s.id),
    coverage: actorCoverage(s.techniques, byTech),
    groups: GROUPS.filter((g) => g.software.includes(s.id)).map((g) => ({ id: g.id, name: g.name })),
  });
});

// GET /api/threat-intel/techniques/T1003 — mitigations, and the groups / software
// using the technique (for a parent: or any of its sub-techniques)
router.get('/techniques/:id', (req, res) => {
  const id = resolveTechniqueId(req.params.id.toUpperCase());
  if (!id) {
    res.status(404).json({ error: 'Unknown technique' });
    return;
  }
  const ids = id.includes('.') ? [id] : Array.from(TECHNIQUE_BY_ID.keys()).filter((t) => parentTechniqueId(t) === id);
  const collect = <T extends { id: string }>(index: Map<string, T[]>) => {
    const out = new Map<string, { item: T; via: string[] }>();
    for (const t of ids) for (const item of index.get(t) ?? []) out.set(item.id, { item, via: [...(out.get(item.id)?.via ?? []), t] });
    return Array.from(out.values());
  };
  res.json({
    id,
    name: TECHNIQUE_BY_ID.get(id)?.name ?? id,
    mitigations: collect(MITIGATIONS_BY_TECHNIQUE)
      .map(({ item: m, via }) => ({ id: m.id, name: m.name, description: m.description, url: attackObjectUrl(m.id), via }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    groups: collect(GROUPS_BY_TECHNIQUE)
      .map(({ item: g, via }) => ({ id: g.id, name: g.name, via }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    software: collect(SOFTWARE_BY_TECHNIQUE)
      .map(({ item: s, via }) => ({ id: s.id, name: s.name, type: s.type, via }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

// GET /api/threat-intel/techniques/T1003/d3fend — D3FEND countermeasures (fetched on first use)
router.get('/techniques/:id/d3fend', async (req, res) => {
  const id = resolveTechniqueId(req.params.id.toUpperCase());
  if (!id) {
    res.status(404).json({ error: 'Unknown technique' });
    return;
  }
  res.json(await getD3fend(id));
});

export default router;
