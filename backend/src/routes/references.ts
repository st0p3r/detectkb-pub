import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import {
  REFERENCE_KINDS,
  ReferenceKind,
  computeReferenceMatches,
  fetchReferenceData,
  isReferenceKind,
  storeReferenceData,
} from '../lib/references';

const router = Router();

type Obj = Record<string, unknown>;

// GET /api/references — datasets with entry / coverage counts
router.get('/', async (_req, res) => {
  const [datasets, matches] = await Promise.all([prisma.referenceDataset.findMany(), computeReferenceMatches()]);
  res.json(
    (Object.keys(REFERENCE_KINDS) as ReferenceKind[]).map((kind) => {
      const ds = datasets.find((d) => d.kind === kind);
      const covered = Array.from(matches.byEntry.keys()).filter((k) => k.startsWith(`${kind}:`)).length;
      return { kind, ...REFERENCE_KINDS[kind], count: ds?.count ?? 0, covered, fetchedAt: ds?.fetchedAt ?? null, source: ds?.source ?? null };
    })
  );
});

// GET /api/references/page/:pageId — references mentioned by one rule
router.get('/page/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const matches = (await computeReferenceMatches()).byPage.get(pageId) ?? [];
  if (!matches.length) {
    res.json([]);
    return;
  }
  const entries = await prisma.referenceEntry.findMany({
    where: { OR: matches.map((m) => ({ kind: m.kind, key: m.key })) },
    select: { kind: true, key: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(entries);
});

// POST /api/references/update — { kinds?: [...] } fetch from the official APIs
router.post('/update', requirePermission('settings:manage'), async (req, res) => {
  const requested = Array.isArray(req.body?.kinds) ? (req.body.kinds as string[]) : Object.keys(REFERENCE_KINDS);
  const results: { kind: string; count?: number; error?: string }[] = [];
  for (const kind of requested.filter(isReferenceKind)) {
    try {
      results.push({ kind, count: await fetchReferenceData(kind) });
    } catch (err) {
      results.push({ kind, error: (err as Error).message });
    }
  }
  res.json(results);
});

// POST /api/references/upload — { kind, content } for offline servers: the official API JSON file
router.post('/upload', requirePermission('settings:manage'), async (req, res) => {
  const { kind, content, fileName } = req.body as { kind?: string; content?: string; fileName?: string };
  if (!kind || !isReferenceKind(kind) || typeof content !== 'string') {
    res.status(400).json({ error: 'kind (lolbas | gtfobins | loldrivers) and content are required' });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    res.status(400).json({ error: 'File is not valid JSON' });
    return;
  }
  try {
    const count = await storeReferenceData(kind, json, `upload: ${fileName || 'file'}`);
    res.json({ kind, count });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/references/:kind?q=&covered=yes|no — entries with the rules that mention them
router.get('/:kind', async (req, res) => {
  const { kind } = req.params;
  if (!isReferenceKind(kind)) {
    res.status(404).json({ error: 'Unknown reference kind' });
    return;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const [entries, matches] = await Promise.all([
    prisma.referenceEntry.findMany({ where: { kind }, orderBy: { name: 'asc' } }),
    computeReferenceMatches(),
  ]);

  const items = entries
    .map((e) => {
      const data = (e.data ?? {}) as Obj;
      const rules = matches.byEntry.get(`${kind}:${e.key}`) ?? [];
      // Summary only; GET /:kind/:key has the full record
      return {
        key: e.key,
        name: e.name,
        description: String(data.description ?? data.comment ?? '').slice(0, 300),
        categories: (data.categories as string[] | undefined) ?? (data.category ? [String(data.category)] : []),
        mitre: (data.mitre as string[] | undefined) ?? [],
        verified: data.verified,
        rules,
      };
    })
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.categories.some((c) => c.toLowerCase().includes(q)));

  const covered = req.query.covered;
  res.json(covered === 'yes' ? items.filter((i) => i.rules.length) : covered === 'no' ? items.filter((i) => !i.rules.length) : items);
});

// GET /api/references/:kind/:key — full record
router.get('/:kind/:key', async (req, res) => {
  const { kind, key } = req.params;
  if (!isReferenceKind(kind)) {
    res.status(404).json({ error: 'Unknown reference kind' });
    return;
  }
  const entry = await prisma.referenceEntry.findUnique({ where: { kind_key: { kind, key } } });
  if (!entry) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const rules = (await computeReferenceMatches()).byEntry.get(`${kind}:${key}`) ?? [];
  res.json({ ...entry, rules });
});

export default router;
