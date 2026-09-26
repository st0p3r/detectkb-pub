import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { JWT_SECRET } from '../lib/config';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const JWT_EXPIRY = '24h';

// ── Login rate limiting (in-memory, per client IP + username) ────────────────
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function loginKey(req: Request, username: string) {
  return `${req.ip}|${username.toLowerCase()}`;
}

function isLoginBlocked(key: string): number {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  if (entry.resetAt <= Date.now()) {
    loginFailures.delete(key);
    return 0;
  }
  return entry.count >= LOGIN_MAX_FAILURES ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
}

function recordLoginFailure(key: string) {
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    loginFailures.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginFailures) if (entry.resetAt <= now) loginFailures.delete(key);
}, LOGIN_WINDOW_MS).unref();

const userWithRolesInclude = {
  userRoles: {
    include: {
      role: {
        include: { permissions: { include: { permission: true } } },
      },
    },
  },
} as const;

async function findUserWithRoles(username: string) {
  return prisma.user.findUnique({ where: { username }, include: userWithRolesInclude });
}

type UserWithRoles = NonNullable<Awaited<ReturnType<typeof findUserWithRoles>>>;

function buildToken(user: UserWithRoles) {
  const roles = user.userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(
      user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.name))
    )
  );
  const token = jwt.sign({ userId: user.id, username: user.username, roles, permissions }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
  return { token, roles, permissions };
}

async function logAuthEvent(
  req: Request,
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE',
  userId: number | null,
  username?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resourceType: 'auth',
        newValue: username ? { username } : undefined,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
      },
    });
  } catch {
    // audit logging must never block authentication
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const key = loginKey(req, username);
  const retryAfter = isLoginBlocked(key);
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: `Too many failed login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
    return;
  }

  const user = await findUserWithRoles(username);
  const valid = !!user && user.isActive && (await bcrypt.compare(password, user.passwordHash));

  if (!user || !valid) {
    recordLoginFailure(key);
    await logAuthEvent(req, 'LOGIN_FAILURE', user?.id ?? null, username);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  loginFailures.delete(key);
  const { token, roles, permissions } = buildToken(user);
  await logAuthEvent(req, 'LOGIN_SUCCESS', user.id);

  res.json({ token, username: user.username, roles, permissions, mustChangePassword: user.mustChangePassword });
});

// POST /api/auth/verify
router.post('/verify', authMiddleware, (req, res) => {
  const { username, roles, permissions, mustChangePassword } = req.user!;
  res.json({ valid: true, username, roles, permissions, mustChangePassword });
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
    // 400, not 401: a 401 makes the frontend log the user out
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: 'New password must differ from the current one' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  res.json({ message: 'Password changed successfully' });
});

export default router;
