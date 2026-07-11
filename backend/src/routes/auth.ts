import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'detectkb-dev-secret-change-in-production';
const JWT_EXPIRY = '24h';

async function getUserWithRoles(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
    },
  });
}

function buildToken(user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>) {
  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(
      user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.name))
    )
  );
  return jwt.sign({ userId: user.id, username: user.username, roles, permissions }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const foundUser = await prisma.user.findUnique({
    where: { username },
    include: {
      userRoles: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
    },
  });
  const user = foundUser;

  if (!user || !user.isActive) {
    // Log failed login attempt
    try {
      await prisma.auditLog.create({
        data: {
          userId: foundUser?.id || null,
          action: 'LOGIN_FAILURE',
          resourceType: 'auth',
          newValue: { username: username },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || null,
        },
      });
    } catch {}
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    // Log failed login attempt
    try {
      await prisma.auditLog.create({
        data: {
          userId: foundUser?.id || null,
          action: 'LOGIN_FAILURE',
          resourceType: 'auth',
          newValue: { username: username },
          ipAddress: req.ip || req.headers['x-forwarded-for'] as string || null,
        },
      });
    } catch {}
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.name)))
  );
  const token = jwt.sign(
    { userId: user.id, username: user.username, roles, permissions },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  // Log successful login
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        resourceType: 'auth',
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || null,
      },
    });
  } catch {}

  res.json({ token, username: user.username, roles, permissions });
});

// POST /api/auth/verify
router.post('/verify', authMiddleware, (req, res) => {
  res.json({ valid: true, username: req.user!.username, roles: req.user!.roles });
});

// PUT /api/auth/password — change own password
router.put('/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
    return;
  }

  const userId = req.user!.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

  res.json({ message: 'Password changed successfully' });
});

export default router;
