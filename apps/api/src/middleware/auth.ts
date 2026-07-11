import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'stock-notifier-secret-key';

export interface AuthPayload {
  id: string;
  username: string;
}

/** Distinct shape from AuthPayload (no id/username) so a regular user's JWT can never satisfy requireAdmin, and vice versa, despite sharing JWT_SECRET. */
export interface AdminPayload {
  role: 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      admin?: AdminPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授權，請先登入' });
    return;
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: '登入已過期，請重新登入' });
  }
}

/** Single shared admin password gate (see routes/admin.ts) — short-lived token, not a per-admin account. */
export function signAdminToken(): string {
  return jwt.sign({ role: 'admin' } satisfies AdminPayload, JWT_SECRET, { expiresIn: '12h' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未授權' });
    return;
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as Partial<AdminPayload>;
    if (payload.role !== 'admin') {
      res.status(401).json({ error: '未授權' });
      return;
    }
    req.admin = payload as AdminPayload;
    next();
  } catch {
    res.status(401).json({ error: '登入已過期，請重新登入' });
  }
}
