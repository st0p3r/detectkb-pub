import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { isAdmin } from '../middleware/auth';
import { TECHNIQUES, parentTechniqueId, parseTechniqueIds, resolveTechniqueId } from '../lib/attack';

const router = Router();

const PAGE_SUMMARY = { id: true, title: true, slug: true, type: true, updatedAt: true } as const;

const countBy = <K extends string>(rows: ({ [k in K]: string | null } & { _count: { _all: number } })[], key: K) =>
  Object.fromEntries(rows.map((r) => [r[key] ?? 'manual', r._count._all]));

// GET /api/dashboard — everything the dashboard shows, as counts and short
// lists, instead of the client downloading every page and rule to count them.
router.get('/', async (req, res) => {
  const can = (p: string) => isAdmin(req.user!) || req.user!.permissions.includes(p);

  const pages = can('pages:read')
    ? await Promise.all([
        prisma.page.groupBy({ by: ['type'], _count: { _all: true } }),
        prisma.page.findMany({ where: { isPinned: true }, select: PAGE_SUMMARY, orderBy: { title: 'asc' } }),
        prisma.page.findMany({ select: PAGE_SUMMARY, orderBy: { updatedAt: 'desc' }, take: 8 }),
        prisma.splCommand.count(),
      ]).then(([byType, pinned, recent, splCommands]) => ({ byType: countBy(byType, 'type'), pinned, recent, splCommands }))
    : null;

  const rules = can('rules:read')
    ? await Promise.all([
        prisma.detectionRule.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.detectionRule.groupBy({ by: ['severity'], _count: { _all: true } }),
        prisma.detectionRule.groupBy({ by: ['sourceFormat'], _count: { _all: true } }),
        prisma.detectionRule.findMany({
          where: { status: 'draft' },
          select: { id: true, status: true, severity: true, page: { select: PAGE_SUMMARY } },
          orderBy: { page: { updatedAt: 'desc' } },
          take: 5,
        }),
        prisma.detectionRule.findMany({ where: { status: { not: 'deprecated' } }, select: { mitreTechniques: true } }),
      ]).then(([byStatus, bySeverity, bySource, drafts, active]) => {
        // Same measure as the ATT&CK Coverage page: parent techniques with at
        // least one non-deprecated rule
        const covered = new Set<string>();
        for (const r of active)
          for (const raw of parseTechniqueIds(r.mitreTechniques)) {
            const id = resolveTechniqueId(raw);
            if (id) covered.add(parentTechniqueId(id));
          }
        return {
          total: byStatus.reduce((n, g) => n + g._count._all, 0),
          byStatus: countBy(byStatus, 'status'),
          bySeverity: countBy(bySeverity, 'severity'),
          bySource: countBy(bySource, 'sourceFormat'),
          drafts,
          coverage: { covered: covered.size, total: TECHNIQUES.filter((t) => !t.id.includes('.')).length },
        };
      })
    : null;

  res.json({ pages, rules });
});

export default router;
