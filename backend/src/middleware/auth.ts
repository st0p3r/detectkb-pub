import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../lib/config';
import { prisma } from '../lib/prisma';

export interface AuthUser {
  userId?: number;
  username: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Endpoints a user who must change their password can still reach.
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/password', '/api/auth/verify', '/api/users/me']);

export const JWT_ALGORITHM = 'HS256' as const;

interface TokenPayload {
  userId?: number;
  /** User.tokenVersion when the token was issued */
  tv?: number;
}

function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    return typeof payload === 'object' ? (payload as TokenPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Roles and permissions are loaded from the database on every request (not
 * trusted from the JWT), so role changes and deactivations apply immediately.
 */
async function loadUser(userId: number, tokenVersion: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
    },
  });
  if (!user || !user.isActive || user.tokenVersion !== tokenVersion) return null;
  return {
    userId: user.id,
    username: user.username,
    roles: user.userRoles.map((ur) => ur.role.name),
    permissions: Array.from(
      new Set(user.userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.name)))
    ),
    mustChangePassword: user.mustChangePassword,
  };
}

async function authenticate(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const payload = verifyToken(authHeader.slice(7));
  if (!payload?.userId) return null;
  return loadUser(payload.userId, payload.tv ?? 0);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  authenticate(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.originalUrl.split('?')[0])) {
        res.status(403).json({ error: 'You must change your password first', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}

export function isAdmin(user: AuthUser): boolean {
  return user.roles.includes('admin');
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!roles.some((r) => req.user!.roles.includes(r))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

/** Passes when the user has any of the given permissions (admins always pass). */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!isAdmin(req.user) && !permissions.some((p) => req.user!.permissions.includes(p))) {
      res.status(403).json({ error: `Forbidden: requires ${permissions.join(' or ')}` });
      return;
    }
    next();
  };
}

const METHOD_ACTION: Record<string, string> = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Maps the HTTP method to a `<resource>:<action>` permission: POST → create,
 * PUT/PATCH → update, DELETE → delete. Reads are only checked when
 * `checkReads` is set (every logged-in user may read shared reference data).
 * Must run after authMiddleware.
 */
export function guard(resource: string, { checkReads = false } = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const action = METHOD_ACTION[req.method];
    if (!action || (action === 'read' && !checkReads)) return next();
    requirePermission(`${resource}:${action}`)(req, res, next);
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  authenticate(req)
    .then((user) => {
      if (user) req.user = user;
      next();
    })
    .catch(next);
}
