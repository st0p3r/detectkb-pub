import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

router.use(authMiddleware);

// GET /api/activity/stats?days=30
router.get('/stats', async (req, res) => {
  const days = Math.min(parseInt(req.query.days as string || '30'), 90);
  const since = new Date(Date.now() - days * 86400000);

  const [recentLogs, loginStats, actionBreakdown, userActivity] = await Promise.all([
    // Recent 50 audit log entries
    prisma.auditLog.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: 50,
      include: { user: { select: { username: true } } },
    }),
    // Daily login counts
    prisma.auditLog.findMany({
      where: { action: 'LOGIN_SUCCESS', timestamp: { gte: since } },
      select: { timestamp: true },
      orderBy: { timestamp: 'asc' },
    }),
    // Action type breakdown
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { timestamp: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    // Per-user login counts
    prisma.auditLog.groupBy({
      by: ['userId'],
      where: { action: 'LOGIN_SUCCESS', timestamp: { gte: since }, userId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
  ]);

  // Build daily counts array
  const dailyMap: Record<string, number> = {};
  for (let d = 0; d < days; d++) {
    const dt = new Date(Date.now() - (days - 1 - d) * 86400000);
    dailyMap[dt.toISOString().slice(0, 10)] = 0;
  }
  for (const log of loginStats) {
    const key = new Date(log.timestamp).toISOString().slice(0, 10);
    if (key in dailyMap) dailyMap[key]++;
  }
  const dailyLogins = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

  // Resolve user IDs to usernames for userActivity
  const userIds = userActivity.map((u) => u.userId).filter(Boolean) as number[];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.username]));

  res.json({
    dailyLogins,
    actionBreakdown: actionBreakdown.map((a) => ({ action: a.action, count: a._count.id })),
    userLogins: userActivity.map((u) => ({
      username: userMap[u.userId!] || 'Unknown',
      count: u._count.id,
    })),
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      action: l.action,
      resourceType: l.resourceType,
      timestamp: l.timestamp,
      username: l.user?.username || null,
      ipAddress: l.ipAddress,
    })),
    summary: {
      totalLogins: loginStats.length,
      failedLogins: await prisma.auditLog.count({
        where: { action: 'LOGIN_FAILURE', timestamp: { gte: since } },
      }),
      totalActions: recentLogs.length,
      activeUsers: new Set(loginStats.map(() => '')).size,
    },
  });
});

export default router;
