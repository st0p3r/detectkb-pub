import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/auth';

const router = Router();


// GET /api/users — list all users (admin only)
router.get('/', requireRole('admin'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      createdAt: true,
      userRoles: { include: { role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users);
});

// GET /api/users/me — current user profile
router.get('/me', async (req, res) => {
  const userId = req.user!.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      createdAt: true,
      userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  res.json(user);
});

// GET /api/users/roles — list all roles
router.get('/roles', async (_req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
  res.json(roles);
});

// POST /api/users — create user (admin only)
router.post('/', requireRole('admin'), async (req, res) => {
  const { username, email, password, firstName, lastName, roleIds } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    roleIds?: number[];
  };

  if (!username || !email || !password) {
    res.status(400).json({ error: 'username, email, and password are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    res.status(409).json({ error: 'Username or email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      mustChangePassword: true,
      firstName: firstName || null,
      lastName: lastName || null,
      userRoles: roleIds?.length
        ? { create: roleIds.map((roleId) => ({ roleId })) }
        : undefined,
    },
    include: { userRoles: { include: { role: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'user',
      resourceId: user.id,
      newValue: { username: user.username, email: user.email },
    },
  });

  const { passwordHash: _ph, ...safeUser } = user as typeof user & { passwordHash: string };
  res.status(201).json(safeUser);
});

// PUT /api/users/:id — update user info (admin only)
router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { firstName, lastName, email, isActive } = req.body as {
    firstName?: string;
    lastName?: string;
    email?: string;
    isActive?: boolean;
  };

  const user = await prisma.user.update({
    where: { id },
    data: {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      email: email ?? undefined,
      isActive: isActive ?? undefined,
    },
    select: {
      id: true, username: true, email: true,
      firstName: true, lastName: true, isActive: true,
      userRoles: { include: { role: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'user',
      resourceId: id,
      newValue: { firstName, lastName, email, isActive },
    },
  });

  res.json(user);
});

// PUT /api/users/:id/roles — update roles (admin only)
router.put('/:id/roles', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { roleIds } = req.body as { roleIds?: number[] };

  if (!Array.isArray(roleIds)) {
    res.status(400).json({ error: 'roleIds must be an array' });
    return;
  }

  await prisma.userRole.deleteMany({ where: { userId: id } });

  const user = await prisma.user.update({
    where: { id },
    data: {
      userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
    select: {
      id: true, username: true, email: true,
      isActive: true, userRoles: { include: { role: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action: 'PERMISSION_CHANGE',
      resourceType: 'user',
      resourceId: id,
      newValue: { roleIds },
    },
  });

  res.json(user);
});

// PATCH /api/users/:id/toggle — toggle active status (admin only, can't disable self)
router.patch('/:id/toggle', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.user?.userId === id) {
    res.status(400).json({ error: 'Cannot disable your own account' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: !user.isActive },
    select: { id: true, username: true, isActive: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'user',
      resourceId: id,
      newValue: { isActive: updated.isActive },
    },
  });

  res.json(updated);
});

// PUT /api/users/:id/password — reset user password (admin only)
router.put('/:id/password', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body as { newPassword?: string };

  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'newPassword must be at least 6 characters' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // A password set by an admin is temporary: the user must pick their own.
  await prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'user',
      resourceId: id,
      newValue: { action: 'password_reset' },
    },
  });

  res.json({ message: 'Password updated' });
});

// GET /api/users/audit — audit log (admin only)
router.get('/audit', requireRole('admin'), async (req, res) => {
  const page = parseInt(String(req.query.page || '1'));
  const limit = Math.min(parseInt(String(req.query.limit || '50')), 100);
  const skip = (page - 1) * limit;

  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: 'desc' },
    skip,
    take: limit,
    include: { user: { select: { username: true } } },
  });

  const total = await prisma.auditLog.count();
  res.json({ logs, total, page, limit });
});

export default router;
