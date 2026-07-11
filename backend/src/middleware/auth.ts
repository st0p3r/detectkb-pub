import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'detectkb-dev-secret-change-in-production';

export interface AuthUser {
  userId?: number;
  username: string;
  roles: string[];
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
    req.user = {
      userId: payload.userId as number | undefined,
      username: (payload.username as string) || '',
      roles: (payload.roles as string[]) || [],
      permissions: (payload.permissions as string[]) || [],
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const hasRole = roles.some((r) => req.user!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const hasAny = permissions.some((p) => req.user!.permissions.includes(p));
    if (!hasAny) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      req.user = {
        userId: payload.userId as number | undefined,
        username: (payload.username as string) || '',
        roles: (payload.roles as string[]) || [],
        permissions: (payload.permissions as string[]) || [],
      };
    } catch {
      // ignore
    }
  }
  next();
}
