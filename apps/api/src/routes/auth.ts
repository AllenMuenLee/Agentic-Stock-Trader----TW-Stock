import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { requireAuth, signToken } from '../middleware/auth';
import { NotificationService } from '../services/notification.service';

const router = Router();
const prisma = new PrismaClient();
const notifier = new NotificationService();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function buildVerifyUrl(token: string): string {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
}

async function issueVerification(userId: string, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifyToken: token, emailVerifyTokenExpiry: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });
  notifier.sendVerificationEmail(email, buildVerifyUrl(token)).catch((err) =>
    console.error('[Auth] Failed to send verification email:', err),
  );
}

/** Derives a display username from an email's local-part (used in NavBar/settings/LINE-bind messages only — no longer a registration field). Disambiguates on collision. */
async function deriveUsername(email: string): Promise<string> {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
  let candidate = base;
  let suffix = 1;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    suffix++;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

// POST /api/auth/register — email + password only. Account starts unverified;
// no token is issued here (see the "block login until verified" design) —
// the user must click the emailed verification link before they can log in.
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: '請輸入 Email 與密碼' });
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: '請輸入有效的 Email 地址' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密碼至少需要 6 個字元' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: '此 Email 已被註冊' });
      return;
    }

    const username = await deriveUsername(email);
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { username, email, passwordHash, emailVerified: false },
    });
    await issueVerification(user.id, email);

    res.status(201).json({
      message: '註冊成功！請至您的 Email 信箱點擊驗證連結以啟用帳號。',
      email: user.email,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — by email now, not username. Blocks unverified accounts.
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: '請輸入 Email 與密碼' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Email 或密碼錯誤' });
      return;
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      res.status(401).json({ error: 'Email 或密碼錯誤' });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({ error: '請先完成 Email 驗證才能登入', code: 'EMAIL_NOT_VERIFIED' });
      return;
    }

    const token = signToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/verify-email — called by the /verify-email frontend page with the token from the emailed link.
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: '缺少驗證 token' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
    if (!user || !user.emailVerifyTokenExpiry || user.emailVerifyTokenExpiry < new Date()) {
      res.status(400).json({ error: '驗證連結無效或已過期，請重新寄送驗證信' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null, emailVerifyTokenExpiry: null },
    });

    res.json({ ok: true, message: '驗證成功！請重新登入。' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification — always responds generically (doesn't reveal whether the email exists).
router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: '請輸入 Email' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      await issueVerification(user.id, email);
    }

    res.json({ message: '若此 Email 已註冊且尚未驗證，驗證信將重新寄出。' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, username: true, email: true, lineUserId: true, discordUserId: true },
    });
    if (!user) {
      res.status(404).json({ error: '找不到使用者' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/password
router.patch('/password', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: '請輸入目前密碼與新密碼' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: '新密碼至少需要 6 個字元' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) { res.status(404).json({ error: '找不到使用者' }); return; }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      res.status(401).json({ error: '目前密碼不正確' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
