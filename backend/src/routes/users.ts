import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/auth';
import { BCRYPT_ROUNDS, passwordProblem } from '../lib/auth-security';

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

  if (typeof username !== 'string' || typeof email !== 'string' || !username.trim() || !email.trim() || !password) {
    res.status(400).json({ error: 'username, email, and password are required' });
    return;
  }
  if (!/^[A-Za-z0-9._@-]{2,120}$/.test(username)) {
    res.status(400).json({ error: 'Username may only contain letters, digits and . _ @ -' });
    return;
  }
  const problem = passwordProblem(password, username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (roleIds !== undefined && (!Array.isArray(roleIds) || !roleIds.every(Number.isInteger))) {
    res.status(400).json({ error: 'roleIds must be an array of role ids' });
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    res.status(409).json({ error: 'Username or email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
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
  const badString = [firstName, lastName, email].some((v) => v !== undefined && v !== null && typeof v !== 'string');
  if (badString || (isActive !== undefined && typeof isActive !== 'boolean')) {
    res.status(400).json({ error: 'Invalid user fields' });
    return;
  }
  if (req.user?.userId === id && isActive === false) {
    res.status(400).json({ error: 'Cannot disable your own account' });
    return;
  }

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

  if (!Array.isArray(roleIds) || !roleIds.every(Number.isInteger)) {
    res.status(400).json({ error: 'roleIds must be an array of role ids' });
    return;
  }
  // An admin can't strip their own admin role and lock everyone out of user management
  if (req.user?.userId === id) {
    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
    if (adminRole && !roleIds.includes(adminRole.id)) {
      res.status(400).json({ error: 'You cannot remove your own admin role' });
      return;
    }
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

  const target = await prisma.user.findUnique({ where: { id }, select: { username: true } });
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const problem = passwordProblem(newPassword, target.username);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword as string, BCRYPT_ROUNDS);
  // A password set by an admin is temporary: the user must pick their own.
  // Existing sessions of that user end (e.g. after a suspected compromise).
  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
  });

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
