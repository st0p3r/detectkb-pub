import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { isAdmin } from '../middleware/auth';
import { TECHNIQUES, TECHNIQUE_BY_ID, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';
import { rank, scoreResult, searchTerms, type SearchField } from '../lib/search';

const router = Router();

// How many candidates are read per kind (then ranked), and how many are returned
const CANDIDATES = 300;
const LIMIT = { pages: 20, rules: 25, splCommands: 10, techniques: 8 };

const any = <T>(conditions: T[]) => ({ OR: conditions });

// GET /api/search?q=<words> — pages, rules (also by the telemetry they read), SPL commands and ATT&CK techniques
// containing every word of the query, best match first. Each kind is returned
// only to users who may read it. A rule is listed under rules only (not again
// as a page), and each result says where it matched.
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const terms = searchTerms(q);
  const empty = { pages: [], rules: [], splCommands: [], techniques: [], totals: { pages: 0, rules: 0, splCommands: 0 }, terms };
  if (q.length < 2 || !terms.length) return res.json(empty);
  const can = (p: string) => !!req.user && (isAdmin(req.user) || req.user.permissions.includes(p));
  const canPages = can('pages:read');
  const canRules = can('rules:read');

  // "kerberoasting" finds rules mapped to T1558.003 even when they never use the word
  const techniqueIdsFor = (term: string) =>
    TECHNIQUES.filter((t) => t.name.toLowerCase().includes(term) || t.id.toLowerCase().startsWith(term))
      .map((t) => t.id)
      .slice(0, 60);

  const pageWhere: Prisma.PageWhereInput = {
    type: { notIn: ['RULE', 'SPL_COMMAND'] },
    AND: terms.map((t) =>
      any<Prisma.PageWhereInput>([
        { title: { contains: t } },
        { contentMd: { contains: t } },
        { tags: { some: { tag: { name: { contains: t } } } } },
        { category: { name: { contains: t } } },
      ])
    ),
  };
  const ruleWhere: Prisma.DetectionRuleWhereInput = {
    AND: terms.map((t) => {
      const techniques = techniqueIdsFor(t);
      return any<Prisma.DetectionRuleWhereInput>([
        { page: { title: { contains: t } } },
        { page: { contentMd: { contains: t } } },
        { page: { tags: { some: { tag: { name: { contains: t } } } } } },
        { mitreTechniques: { contains: t } },
        { mitreTactics: { contains: t } },
        { dataSource: { contains: t } },
        { splQuery: { contains: t } },
        { nativeQuery: { contains: t } },
        { sigmaYaml: { contains: t } },
        { falsePositives: { contains: t } },
        { triage: { contains: t } },
        { response: { contains: t } },
        { testNotes: { contains: t } },
        { sigmaId: { contains: t } },
        { sourceId: { contains: t } },
        ...(techniques.length ? [{ page: { techniques: { some: { techniqueId: { in: techniques } } } } }] : []),
        // The telemetry it reads, as linked by DetectKB: "4688", "process access", "cloudtrail"
        { page: { logEvents: { some: { logEvent: { OR: [{ code: { contains: t } }, { name: { contains: t } }, { sourceLabel: { contains: t } }] } } } } },
        { page: { sysmonEvents: { some: { sysmonEvent: /^\d+$/.test(t) ? { eventId: Number(t) } : { name: { contains: t } } } } } },
        // The fields its detection reads: "parentcommandline", "grantedaccess"
        { page: { fields: { some: { field: { contains: t } } } } },
      ]);
    }),
  };
  const splWhere: Prisma.SplCommandWhereInput = {
    AND: terms.map((t) =>
      any<Prisma.SplCommandWhereInput>([
        { command: { contains: t } },
        { description: { contains: t } },
        { syntax: { contains: t } },
        { examples: { contains: t } },
        { pitfalls: { contains: t } },
        { group: { contains: t } },
      ])
    ),
  };

  const [pages, pageTotal, rules, ruleTotal, spl, splTotal] = await Promise.all([
    canPages
      ? prisma.page.findMany({
          where: pageWhere,
          select: { id: true, title: true, slug: true, type: true, contentMd: true, updatedAt: true, category: { select: { name: true } }, tags: { select: { tag: { select: { name: true } } } } },
          orderBy: { updatedAt: 'desc' },
          take: CANDIDATES,
        })
      : [],
    canPages ? prisma.page.count({ where: pageWhere }) : 0,
    canRules
      ? prisma.detectionRule.findMany({
          where: ruleWhere,
          select: {
            id: true,
            status: true,
            severity: true,
            mitreTechniques: true,
            mitreTactics: true,
            dataSource: true,
            splQuery: true,
            nativeQuery: true,
            sigmaYaml: true,
            falsePositives: true,
            triage: true,
            response: true,
            testNotes: true,
            sigmaId: true,
            sourceId: true,
            page: {
              select: {
                title: true,
                slug: true,
                contentMd: true,
                updatedAt: true,
                tags: { select: { tag: { select: { name: true } } } },
                logEvents: { select: { logEvent: { select: { sourceLabel: true, code: true, name: true } } } },
                sysmonEvents: { select: { sysmonEvent: { select: { eventId: true, name: true } } } },
                fields: { select: { field: true } },
              },
            },
          },
          orderBy: { page: { updatedAt: 'desc' } },
          take: CANDIDATES,
        })
      : [],
    canRules ? prisma.detectionRule.count({ where: ruleWhere }) : 0,
    canPages
      ? prisma.splCommand.findMany({
          where: splWhere,
          select: { id: true, command: true, group: true, description: true, syntax: true, examples: true, pitfalls: true, page: { select: { slug: true, updatedAt: true } } },
          take: CANDIDATES,
        })
      : [],
    canPages ? prisma.splCommand.count({ where: splWhere }) : 0,
  ]);

  const tagText = (tags: { tag: { name: string } }[]) => tags.map((t) => t.tag.name).join(', ');

  const pageResults = rank(
    pages.flatMap((p) => {
      const fields: SearchField[] = [
        { label: 'Tags', text: tagText(p.tags), weight: 7 },
        { label: 'Category', text: p.category?.name, weight: 5 },
        { label: 'Text', text: p.contentMd, weight: 2 },
      ];
      const s = scoreResult(p.title, fields, terms, p.contentMd);
      return s ? [{ id: p.id, title: p.title, slug: p.slug, type: p.type, updatedAt: p.updatedAt, ...s }] : [];
    })
  );

  const ruleResults = rank(
    rules.flatMap((r) => {
      const ids = parseTechniqueIds(r.mitreTechniques);
      const names = ids.map((id) => TECHNIQUE_BY_ID.get(resolveTechniqueId(id) ?? '')?.name).filter(Boolean);
      const fields: SearchField[] = [
        { label: 'ATT&CK technique', text: [...ids, ...names].join(', '), weight: 8, skipNumbers: true },
        { label: 'Tags', text: tagText(r.page.tags), weight: 7 },
        { label: 'Rule ID', text: [r.sigmaId, r.sourceId].filter(Boolean).join(' '), weight: 7 },
        { label: 'Data source', text: r.dataSource, weight: 5 },
        {
          label: 'Telemetry',
          text: [
            ...r.page.sysmonEvents.map((l) => `Sysmon ${l.sysmonEvent.eventId} ${l.sysmonEvent.name}`),
            ...r.page.logEvents.map((l) => `${l.logEvent.sourceLabel} ${l.logEvent.code === '*' ? '' : l.logEvent.code} ${l.logEvent.name}`.replace(/\s+/g, ' ')),
          ].join(', '),
          weight: 5,
        },
        { label: 'Tactic', text: r.mitreTactics, weight: 5 },
        { label: 'Field', text: r.page.fields.map((f) => f.field).join(', '), weight: 5 },
        { label: 'SPL query', text: r.splQuery, weight: 4 },
        { label: 'Query', text: r.nativeQuery, weight: 4 },
        { label: 'False positives', text: r.falsePositives, weight: 3 },
        { label: 'Triage steps', text: r.triage, weight: 3 },
        { label: 'Response steps', text: r.response, weight: 3 },
        { label: 'Description', text: r.page.contentMd, weight: 2 },
        { label: 'Sigma rule', text: r.sigmaYaml, weight: 2 },
        { label: 'Test notes', text: r.testNotes, weight: 2 },
      ];
      const s = scoreResult(r.page.title, fields, terms, r.page.contentMd || r.splQuery || r.nativeQuery);
      return s ? [{ id: r.id, title: r.page.title, slug: r.page.slug, type: 'RULE', status: r.status, severity: r.severity, updatedAt: r.page.updatedAt, ...s }] : [];
    })
  );

  const splResults = rank(
    spl.flatMap((c) => {
      const fields: SearchField[] = [
        { label: 'Group', text: c.group, weight: 5 },
        { label: 'Description', text: c.description, weight: 4 },
        { label: 'Syntax', text: c.syntax, weight: 4 },
        { label: 'Examples', text: c.examples, weight: 2 },
        { label: 'Pitfalls', text: c.pitfalls, weight: 2 },
      ];
      const s = scoreResult(c.command, fields, terms, c.description);
      return s ? [{ id: c.id, title: c.command, slug: c.page.slug, type: 'SPL_COMMAND', updatedAt: c.page.updatedAt, ...s }] : [];
    })
  );

  // ATT&CK techniques by ID or name, with how many rules are mapped to each
  const matched = canRules
    ? rank(
        TECHNIQUES.flatMap((t) => {
          const s = scoreResult(`${t.id} ${t.name}`, [], terms);
          return s ? [{ id: t.id, name: t.name, score: s.score + (t.id.toLowerCase() === terms[0] ? 100 : 0) }] : [];
        })
      ).slice(0, LIMIT.techniques)
    : [];
  const counts = matched.length
    ? await prisma.ruleTechnique.groupBy({ by: ['techniqueId'], where: { techniqueId: { in: matched.map((t) => t.id) } }, _count: { _all: true } })
    : [];
  const ruleCount = new Map(counts.map((c) => [c.techniqueId, c._count._all]));

  const out = <T extends { score: number; updatedAt?: Date }>(items: T[], limit: number) => items.slice(0, limit).map(({ updatedAt: _u, ...rest }) => rest);
  res.json({
    pages: out(pageResults, LIMIT.pages),
    rules: out(ruleResults, LIMIT.rules),
    splCommands: out(splResults, LIMIT.splCommands),
    techniques: matched.map((t) => ({ id: t.id, name: t.name, rules: ruleCount.get(t.id) ?? 0 })),
    /** How many match in all (more than are listed when the query is broad) */
    // When every candidate was read, the ranked count is exact (the database's is a little generous)
    totals: {
      pages: pages.length < CANDIDATES ? pageResults.length : pageTotal,
      rules: rules.length < CANDIDATES ? ruleResults.length : ruleTotal,
      splCommands: spl.length < CANDIDATES ? splResults.length : splTotal,
    },
    terms,
  });
});

export default router;
