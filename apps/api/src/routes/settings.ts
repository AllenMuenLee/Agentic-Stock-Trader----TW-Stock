import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { NotificationService } from '../services/notification.service';

const router = Router();
const prisma = new PrismaClient();
const notifier = new NotificationService();

const DEFAULT_USER_ID = 'default-user';

async function ensureDefaultUser() {
  return prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    create: { id: DEFAULT_USER_ID },
    update: {},
  });
}

// GET /api/settings
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await ensureDefaultUser();
    res.json({
      email: user.email,
      lineToken: user.lineToken,
      discordWebhook: user.discordWebhook,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, lineToken, discordWebhook } = req.body as {
      email?: string;
      lineToken?: string;
      discordWebhook?: string;
    };

    const user = await prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      create: {
        id: DEFAULT_USER_ID,
        email: email || null,
        lineToken: lineToken || null,
        discordWebhook: discordWebhook || null,
      },
      update: {
        email: email !== undefined ? email || null : undefined,
        lineToken: lineToken !== undefined ? lineToken || null : undefined,
        discordWebhook: discordWebhook !== undefined ? discordWebhook || null : undefined,
      },
    });

    res.json({
      email: user.email,
      lineToken: user.lineToken,
      discordWebhook: user.discordWebhook,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/test-notification
router.post('/test-notification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channel } = req.body as { channel: 'email' | 'line' | 'discord' };
    const user = await ensureDefaultUser();

    const payload = {
      title: 'Test Notification',
      message: 'This is a test notification from Agentic Stock Notifier!',
      symbol: '2330',
      signal: 'BUY',
      price: 900,
    };

    if (channel === 'email' && user.email) {
      await notifier.sendEmail(user.email, payload);
    } else if (channel === 'line' && user.lineToken) {
      await notifier.sendLine(user.lineToken, payload);
    } else if (channel === 'discord' && user.discordWebhook) {
      await notifier.sendDiscord(user.discordWebhook, payload);
    } else {
      res.status(400).json({ error: `No ${channel} credentials configured` });
      return;
    }

    res.json({ ok: true, message: `Test ${channel} notification sent` });
  } catch (err) {
    next(err);
  }
});

export default router;
