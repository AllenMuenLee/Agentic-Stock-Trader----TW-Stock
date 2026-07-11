import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { NotificationService } from '../services/notification.service';
import { requireAuth } from '../middleware/auth';
import { EMAIL_REGEX, issueVerification } from '../services/email-verification';

const router = Router();
const prisma = new PrismaClient();
const notifier = new NotificationService();

router.use(requireAuth);

// GET /api/settings
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    res.json({
      email: user?.email ?? null,
      lineUserId: user?.lineUserId ?? null,
      discordUserId: user?.discordUserId ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings — only email is updatable here; LINE/Discord use /api/bind/*.
// Email is also the login identifier now (see auth.ts), so it can no longer be
// cleared, must be unique, and changing it re-triggers verification — the
// account keeps its current session but won't be able to log in again under
// the new address until it's verified.
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body as { email?: string };
    if (email === undefined) {
      const current = await prisma.user.findUnique({ where: { id: req.user!.id } });
      res.json({ email: current?.email ?? null, lineUserId: current?.lineUserId ?? null, discordUserId: current?.discordUserId ?? null });
      return;
    }

    const trimmed = email.trim();
    if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
      res.status(400).json({ error: '請輸入有效的 Email 地址' });
      return;
    }

    const current = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!current) { res.status(404).json({ error: '找不到使用者' }); return; }

    if (trimmed === current.email) {
      res.json({ email: current.email, lineUserId: current.lineUserId, discordUserId: current.discordUserId });
      return;
    }

    let user;
    try {
      user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { email: trimmed, emailVerified: false },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ error: '此 Email 已被其他帳號使用' });
        return;
      }
      throw err;
    }

    await issueVerification(prisma, notifier, user.id, user.email);

    res.json({
      email: user.email,
      lineUserId: user.lineUserId,
      discordUserId: user.discordUserId,
      message: '已寄送驗證信至新的 Email，請完成驗證（下次登入需使用已驗證的 Email）。',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/test-notification
router.post('/test-notification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channel } = req.body as { channel: 'email' | 'line' | 'discord' };
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    const payload = {
      title: 'Test Notification',
      message: 'This is a test notification from AI股探!',
      symbol: '2330',
      signal: 'BUY',
      price: 900,
    };

    if (channel === 'email' && user?.email) {
      await notifier.sendEmail(user.email, payload);
    } else if (channel === 'line' && user?.lineUserId) {
      await notifier.sendLine(user.lineUserId, payload);
    } else if (channel === 'discord' && user?.discordUserId) {
      const joined = await notifier.isDiscordGuildMember(user.discordUserId);
      if (!joined) {
        res.status(400).json({ error: 'discord_not_in_guild', message: '請先加入指定的 Discord 伺服器，才能接收私訊通知' });
        return;
      }
      await notifier.sendDiscordDM(user.discordUserId, payload);
    } else {
      res.status(400).json({ error: `No ${channel} binding configured` });
      return;
    }

    res.json({ ok: true, message: `Test ${channel} notification sent` });
  } catch (err) {
    next(err);
  }
});

export default router;
