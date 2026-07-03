import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import QRCode from 'qrcode';
import { requireAuth } from '../middleware/auth';
import { NotificationService } from '../services/notification.service';

const router = Router();
const prisma = new PrismaClient();
const notifier = new NotificationService();

const JWT_SECRET = process.env.JWT_SECRET || 'stock-notifier-secret-key';

// ─── LINE binding ─────────────────────────────────────────────────────────────

// GET /api/bind/line/code — generate 6-char binding code
router.get('/line/code', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { lineBindCode: code, lineBindExpiry: expiry },
    });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const botBasicId = process.env.LINE_BOT_BASIC_ID || '';

    // LINE doesn't expose a static QR image URL for an Official Account, so we
    // render one ourselves from the official add-friend link (line.me/R/ti/p/@<id>).
    const qrCodeUrl = botBasicId
      ? await QRCode.toDataURL(`https://line.me/R/ti/p/%40${botBasicId.replace(/^@/, '')}`, {
          width: 320,
          margin: 1,
        })
      : null;

    res.json({
      code,
      expiry: expiry.toISOString(),
      lineUserId: user?.lineUserId ?? null,
      qrCodeUrl,
      botBasicId,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/bind/line/unbind — remove LINE binding
router.post('/line/unbind', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { lineUserId: null, lineBindCode: null, lineBindExpiry: null },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Discord binding ──────────────────────────────────────────────────────────

// GET /api/bind/discord/url — return Discord OAuth2 authorization URL
router.get('/discord/url', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
    if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
      res.status(503).json({ error: 'Discord OAuth2 未設定，請聯繫管理員' });
      return;
    }

    // JWT-signed state for CSRF protection (10-min expiry)
    const state = jwt.sign({ userId: req.user!.id }, JWT_SECRET, { expiresIn: '10m' });

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state,
    });

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    res.json({
      url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
      discordUserId: user?.discordUserId ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bind/discord/callback — OAuth2 code exchange
router.get('/discord/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/settings?discord=error&reason=missing_params`);
    }

    // Verify state
    let userId: string;
    try {
      const payload = jwt.verify(state, JWT_SECRET) as { userId: string };
      userId = payload.userId;
    } catch {
      return res.redirect(`${frontendUrl}/settings?discord=error&reason=invalid_state`);
    }

    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
      return res.redirect(`${frontendUrl}/settings?discord=error&reason=not_configured`);
    }

    // Exchange code for token
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const accessToken = tokenRes.data.access_token as string;

    // Get Discord user ID
    const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const discordUserId = userRes.data.id as string;

    // Store binding
    await prisma.user.update({
      where: { id: userId },
      data: { discordUserId, discordBindCode: null, discordBindExpiry: null },
    });

    return res.redirect(`${frontendUrl}/settings?discord=bound`);
  } catch (err) {
    next(err);
  }
});

// GET /api/bind/discord/guild-status — has the bound user joined the required server?
router.get('/discord/guild-status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const inviteUrl = process.env.DISCORD_INVITE_URL || null;

    if (!user?.discordUserId) {
      res.json({ joined: false, inviteUrl });
      return;
    }

    const joined = await notifier.isDiscordGuildMember(user.discordUserId);
    res.json({ joined, inviteUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/bind/discord/unbind — remove Discord binding
router.post('/discord/unbind', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { discordUserId: null, discordBindCode: null, discordBindExpiry: null },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
