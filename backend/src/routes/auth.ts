import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { JWT_SECRET } from '../lib/config';
import crypto from 'crypto';
import { authMiddleware, JWT_ALGORITHM } from '../middleware/auth';
import { BCRYPT_ROUNDS, LOGIN_WINDOW_MS, LoginThrottle, passwordProblem } from '../lib/auth-security';

const router = Router();

const JWT_EXPIRY = '24h';

// Failed logins are throttled per IP + username, per IP and per username (lib/auth-security)
const throttle = new LoginThrottle();
setInterval(() => throttle.prune(), LOGIN_WINDOW_MS).unref();

// Compared against when the user doesn't exist, so a login takes as long for
// unknown usernames as for known ones (no username enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

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
  const token = jwt.sign({ userId: user.id, tv: user.tokenVersion, username: user.username, roles, permissions }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
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
        ipAddress: clientIp(req),
      },
    });
  } catch {
    // audit logging must never block authentication
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const ip = clientIp(req);
  const retryAfter = throttle.retryAfter(ip, username);
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: `Too many failed login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
    return;
  }

  const user = username.length <= 120 ? await findUserWithRoles(username) : null;
  // Always run bcrypt, also for unknown or disabled users, so timing doesn't reveal which usernames exist
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const valid = !!user && user.isActive && passwordOk;

  if (!user || !valid) {
    throttle.recordFailure(ip, username);
    await logAuthEvent(req, 'LOGIN_FAILURE', user?.id ?? null, username.slice(0, 120));
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  throttle.recordSuccess(ip, username);
  // Hashes from before BCRYPT_ROUNDS went up are upgraded while the password is at hand
  if (bcrypt.getRounds(user.passwordHash) < BCRYPT_ROUNDS) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  }
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

  if (typeof currentPassword !== 'string' || !currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }
  const problem = passwordProblem(newPassword, req.user!.username);
  if (problem) {
    res.status(400).json({ error: problem });
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

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  // Bumping tokenVersion signs out every other session; this one gets a fresh token
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    include: userWithRolesInclude,
  });

  res.json({ message: 'Password changed successfully', token: buildToken(updated).token });
});

export default router;
