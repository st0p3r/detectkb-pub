import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requirePermission } from '../middleware/auth';
import { TECHNIQUE_BY_ID, resolveTechniqueId } from '../lib/attack';
import {
  ATOMIC_INDEX_URL,
  ATOMIC_REPO,
  AtomicInput,
  AtomicRuleMatch,
  ExpectedTelemetry,
  fetchAtomicIndex,
  importAtomicFiles,
  matchRule,
  resolveInputs,
  techniqueRelation,
} from '../lib/atomic';
import { RuleTelemetry, alternatives, loadRuleTelemetry, loadTelemetryInfo } from '../lib/coverage-analysis';
import { describeLogEventKey } from '../lib/log-events';

// Atomic Red Team tests and the rules each one is expected to trigger.

const router = Router();

const techniqueName = (id: string) => TECHNIQUE_BY_ID.get(resolveTechniqueId(id) ?? id)?.name ?? null;
const expectedOf = (json: Prisma.JsonValue) => (Array.isArray(json) ? (json as unknown as ExpectedTelemetry[]) : []);
const platformsOf = (json: Prisma.JsonValue) => (Array.isArray(json) ? json.map(String) : []);

/** Runs one test in a lab with the Invoke-AtomicRedTeam module */
const invokeCommand = (techniqueId: string, guid: string) => `Invoke-AtomicTest ${techniqueId} -TestGuids ${guid}`;

async function telemetryLabels(keys: string[]) {
  const info = await loadTelemetryInfo();
  return new Map(
    keys.map((k) => {
      const known = info.get(k);
      if (known) return [k, { source: known.source, sourceLabel: known.sourceLabel, label: known.label }];
      return [k, k.startsWith('sysmon:') ? { source: 'sysmon', sourceLabel: 'Sysmon', label: `Sysmon ${k.slice(7)}` } : describeLogEventKey(k)];
    })
  );
}

interface RuleForTest {
  pageId: number;
  title: string;
  slug: string;
  status: string;
  severity: string;
  relation: 'exact' | 'parent';
  match: AtomicRuleMatch;
  /** Expected keys the rule reads */
  sharedTelemetry: string[];
}

/** Active rules by technique ID, so a test only looks at the rules of its own technique and parent */
const rulesByTechnique = (() => {
  let cached: { rules: RuleTelemetry[]; index: Map<string, RuleTelemetry[]> } | null = null;
  return (rules: RuleTelemetry[]) => {
    if (cached?.rules !== rules) {
      const index = new Map<string, RuleTelemetry[]>();
      for (const r of rules) {
        if (r.status === 'deprecated') continue;
        for (const t of new Set(r.techniques)) index.set(t, [...(index.get(t) ?? []), r]);
      }
      cached = { rules, index };
    }
    return cached.index;
  };
})();

function rulesForTest(rules: RuleTelemetry[], test: { techniqueId: string; platforms: string[]; expected: Set<string> }): RuleForTest[] {
  const out: RuleForTest[] = [];
  const index = rulesByTechnique(rules);
  const id = resolveTechniqueId(test.techniqueId) ?? test.techniqueId;
  const candidates = new Set([...(index.get(id) ?? []), ...(index.get(id.split('.')[0]) ?? [])]);
  for (const r of candidates) {
    const relations = r.techniques.map((t) => techniqueRelation(t, test.techniqueId)).filter((x): x is RuleForTest['relation'] => !!x);
    if (!relations.length) continue;
    const relation = relations.includes('exact') ? 'exact' : relations[0];
    out.push({
      pageId: r.pageId,
      title: r.title,
      slug: r.slug,
      status: r.status,
      severity: r.severity,
      relation,
      match: matchRule(alternatives(r), test.expected, test.platforms),
      sharedTelemetry: r.telemetry.filter((k) => test.expected.has(k)),
    });
  }
  const order: Record<AtomicRuleMatch, number> = { telemetry: 0, edr: 1, 'other-telemetry': 2, unknown: 3 };
  return out.sort((a, b) => order[a.match] - order[b.match] || a.title.localeCompare(b.title));
}

const matchCounts = (rules: RuleForTest[]) =>
  rules.reduce<Record<AtomicRuleMatch, number>>((m, r) => ((m[r.match] += 1), m), { telemetry: 0, edr: 0, 'other-telemetry': 0, unknown: 0 });

const listSelect = {
  guid: true,
  techniqueId: true,
  testNumber: true,
  name: true,
  platforms: true,
  executor: true,
  elevationRequired: true,
  expectedTelemetry: true,
} as const;

type ListRow = Prisma.AtomicTestGetPayload<{ select: typeof listSelect }>;

function summarize(t: ListRow, rules: RuleTelemetry[]) {
  const expected = expectedOf(t.expectedTelemetry);
  const platforms = platformsOf(t.platforms);
  const matched = rulesForTest(rules, { techniqueId: t.techniqueId, platforms, expected: new Set(expected.map((e) => e.key)) });
  return {
    guid: t.guid,
    techniqueId: t.techniqueId,
    techniqueName: techniqueName(t.techniqueId),
    testNumber: t.testNumber,
    name: t.name,
    platforms,
    executor: t.executor,
    elevationRequired: t.elevationRequired,
    expectedTelemetry: expected.map((e) => e.key),
    rules: matchCounts(matched),
  };
}

// GET /api/atomics?q=&technique=&platform=&executor=&match= — tests with how many rules each should trigger
router.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const technique = String(req.query.technique ?? '').trim().toUpperCase();
  const platform = String(req.query.platform ?? '').trim();
  const executor = String(req.query.executor ?? '').trim();
  const match = String(req.query.match ?? '').trim();
  const [rows, rules, total, allTechniques, last] = await Promise.all([
    prisma.atomicTest.findMany({
      where: {
        AND: [
          q ? { OR: [{ name: { contains: q } }, { techniqueId: { contains: q } }, { guid: q }] } : {},
          technique ? { OR: [{ techniqueId: technique }, { techniqueId: { startsWith: `${technique}.` } }] } : {},
          executor ? { executor } : {},
        ],
      },
      select: listSelect,
      orderBy: [{ techniqueId: 'asc' }, { testNumber: 'asc' }],
    }),
    loadRuleTelemetry(),
    prisma.atomicTest.count(),
    prisma.atomicTest.findMany({ distinct: ['techniqueId'], select: { techniqueId: true } }),
    prisma.atomicTest.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, source: true } }),
  ]);
  let tests = rows.map((t) => summarize(t, rules));
  if (platform) tests = tests.filter((t) => t.platforms.includes(platform));
  if (match === 'telemetry') tests = tests.filter((t) => t.rules.telemetry > 0);
  else if (match === 'none') tests = tests.filter((t) => !t.rules.telemetry && !t.rules.edr && !t.rules['other-telemetry'] && !t.rules.unknown);
  else if (match === 'no-telemetry-match') tests = tests.filter((t) => !t.rules.telemetry);
  res.json({
    repository: ATOMIC_REPO,
    indexUrl: ATOMIC_INDEX_URL,
    total,
    techniques: allTechniques.length,
    updatedAt: last?.updatedAt ?? null,
    source: last?.source ?? null,
    tests,
  });
});

// GET /api/atomics/technique/:id — the tests of a technique (and its sub-techniques)
router.get('/technique/:id', async (req, res) => {
  const id = String(req.params.id).toUpperCase();
  const [rows, rules] = await Promise.all([
    prisma.atomicTest.findMany({
      where: { OR: [{ techniqueId: id }, ...(id.includes('.') ? [] : [{ techniqueId: { startsWith: `${id}.` } }])] },
      select: listSelect,
      orderBy: [{ techniqueId: 'asc' }, { testNumber: 'asc' }],
    }),
    loadRuleTelemetry(),
  ]);
  res.json({ techniqueId: id, tests: rows.map((t) => summarize(t, rules)) });
});

// GET /api/atomics/rule/:pageId — tests of the rule's techniques, and whether each should trigger it
router.get('/rule/:pageId', async (req, res) => {
  const pageId = Number(req.params.pageId);
  const rules = await loadRuleTelemetry();
  const rule = rules.find((r) => r.pageId === pageId);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  // Tests of the rule's techniques, and of the sub-techniques of a parent technique it is tagged with
  const ids = new Set(rule.techniques);
  const rows = ids.size
    ? await prisma.atomicTest.findMany({
        where: { OR: [{ techniqueId: { in: Array.from(ids) } }, ...rule.techniques.filter((t) => !t.includes('.')).map((t) => ({ techniqueId: { startsWith: `${t}.` } }))] },
        select: listSelect,
        orderBy: [{ techniqueId: 'asc' }, { testNumber: 'asc' }],
      })
    : [];
  const tests = rows
    .map((t) => {
      const expected = expectedOf(t.expectedTelemetry);
      const platforms = platformsOf(t.platforms);
      const [link] = rulesForTest([rule], { techniqueId: t.techniqueId, platforms, expected: new Set(expected.map((e) => e.key)) });
      return link
        ? {
            guid: t.guid,
            techniqueId: t.techniqueId,
            testNumber: t.testNumber,
            name: t.name,
            platforms,
            executor: t.executor,
            relation: link.relation,
            match: link.match,
            sharedTelemetry: link.sharedTelemetry,
            invoke: invokeCommand(t.techniqueId, t.guid),
          }
        : null;
    })
    .filter((t): t is NonNullable<typeof t> => !!t);
  const order: Record<AtomicRuleMatch, number> = { telemetry: 0, edr: 1, 'other-telemetry': 2, unknown: 3 };
  tests.sort((a, b) => order[a.match] - order[b.match] || a.techniqueId.localeCompare(b.techniqueId) || a.testNumber - b.testNumber);
  res.json({ pageId, techniques: rule.techniques, tests });
});

// GET /api/atomics/:guid — one test: commands, inputs, expected telemetry and the rules it should trigger
router.get('/:guid', async (req, res) => {
  const test = await prisma.atomicTest.findUnique({ where: { guid: String(req.params.guid) } });
  if (!test) {
    res.status(404).json({ error: 'Test not found' });
    return;
  }
  const inputs = (Array.isArray(test.inputArguments) ? test.inputArguments : []) as unknown as AtomicInput[];
  const expected = expectedOf(test.expectedTelemetry);
  const platforms = platformsOf(test.platforms);
  const [rules, labels] = await Promise.all([loadRuleTelemetry(), telemetryLabels(expected.map((e) => e.key))]);
  const matched = rulesForTest(rules, { techniqueId: test.techniqueId, platforms, expected: new Set(expected.map((e) => e.key)) });
  res.json({
    ...test,
    platforms,
    techniqueName: techniqueName(test.techniqueId),
    inputArguments: inputs,
    resolvedCommand: test.command ? resolveInputs(test.command, inputs) : null,
    resolvedCleanup: test.cleanupCommand ? resolveInputs(test.cleanupCommand, inputs) : null,
    expectedTelemetry: expected.map((e) => ({ ...e, ...labels.get(e.key)! })),
    invoke: invokeCommand(test.techniqueId, test.guid),
    fileUrl: `${ATOMIC_REPO}/blob/master/atomics/${test.techniqueId}/${test.techniqueId}.md`,
    rules: matched,
    ruleCounts: matchCounts(matched),
  });
});

// POST /api/atomics/import — { files: [{ name, content }] } technique files or index.yaml
router.post('/import', requirePermission('settings:manage'), async (req, res) => {
  const files = (req.body?.files ?? []) as { name?: unknown; content?: unknown }[];
  if (!Array.isArray(files) || !files.length) {
    res.status(400).json({ error: 'No files' });
    return;
  }
  const valid = files.filter((f) => typeof f.name === 'string' && typeof f.content === 'string') as { name: string; content: string }[];
  res.json(await importAtomicFiles(valid));
});

// POST /api/atomics/fetch — download the index from GitHub
router.post('/fetch', requirePermission('settings:manage'), async (_req, res) => {
  try {
    res.json(await fetchAtomicIndex());
  } catch (err) {
    res.status(502).json({ error: `Could not download the Atomic Red Team index: ${(err as Error).message}` });
  }
});

export default router;
