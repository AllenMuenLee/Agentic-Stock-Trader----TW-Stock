import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../services/notification.service';
import { requireAuth } from '../middleware/auth';

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

// PUT /api/settings — only email is updatable here; LINE/Discord use /api/bind/*
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body as { email?: string };

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { email: email !== undefined ? email || null : undefined },
    });

    res.json({
      email: user.email,
      lineUserId: user.lineUserId,
      discordUserId: user.discordUserId,
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
      message: 'This is a test notification from 智股通!',
      symbol: '2330',
      signal: 'BUY',
      price: 900,
    };

    if (channel === 'email' && user?.email) {
      await notifier.sendEmail(user.email, payload);
    } else if (channel === 'line' && user?.lineUserId) {
      await notifier.sendLine(user.lineUserId, payload);
    } else if (channel === 'discord' && user?.discordUserId) {
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
