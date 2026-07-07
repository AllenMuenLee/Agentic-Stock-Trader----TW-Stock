import { Request, Response, NextFunction } from 'express';

const ALLOWED_ORIGIN = new URL(process.env.FRONTEND_URL || 'http://localhost:3000').origin;

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const header = req.get('origin') || req.get('referer');
  if (!header) {
    res.status(403).json({ error: '不允許直接呼叫此 API，請透過官方網站使用' });
    return;
  }
  try {
    if (new URL(header).origin !== ALLOWED_ORIGIN) {
      res.status(403).json({ error: '不允許直接呼叫此 API，請透過官方網站使用' });
      return;
    }
  } catch {
    res.status(403).json({ error: '不允許直接呼叫此 API，請透過官方網站使用' });
    return;
  }
  next();
}
