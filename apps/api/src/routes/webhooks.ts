import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();
const prisma = new PrismaClient();

// POST /api/webhooks/line — LINE Messaging API webhook
router.post('/line', async (req: Request, res: Response) => {
  // Verify X-Line-Signature
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (channelSecret) {
    const signature = req.headers['x-line-signature'] as string | undefined;
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('SHA256', channelSecret)
      .update(body)
      .digest('base64');
    if (signature !== expected) {
      res.status(403).json({ error: 'Invalid signature' });
      return;
    }
  }

  const events = req.body?.events as {
    type: string;
    source?: { userId?: string };
    message?: { type: string; text?: string };
    replyToken?: string;
  }[] | undefined;

  if (!events || events.length === 0) {
    res.json({ ok: true });
    return;
  }

  for (const event of events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    if (event.type === 'follow') {
      // User followed the bot — send welcome message
      await replyLine(event.replyToken, '歡迎使用AI股探！\n請發送您的 6 位數綁定碼（大寫英數字）以完成帳號綁定。');
      continue;
    }

    if (event.type === 'message' && event.message?.type === 'text') {
      const text = (event.message.text || '').trim().toUpperCase();

      // Try to match a 6-char hex binding code
      if (/^[0-9A-F]{6}$/.test(text)) {
        const now = new Date();
        const user = await prisma.user.findFirst({
          where: {
            lineBindCode: text,
            lineBindExpiry: { gt: now },
          },
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { lineUserId, lineBindCode: null, lineBindExpiry: null },
          });
          await replyLine(event.replyToken, `綁定成功！您的AI股探帳號（${user.username}）已與 LINE 綁定，股票訊號將即時推送給您。`);
        } else {
          await replyLine(event.replyToken, '綁定碼無效或已過期，請至AI股探設定頁重新取得綁定碼。');
        }
      } else {
        await replyLine(event.replyToken, '請在AI股探設定頁面取得 6 位數綁定碼，並將其發送至此。');
      }
    }
  }

  res.json({ ok: true });
});

async function replyLine(replyToken: string | undefined, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return;
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/reply',
      { replyToken, messages: [{ type: 'text', text }] },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (err) {
    console.error('[Webhook/LINE] Reply failed:', err instanceof Error ? err.message : err);
  }
}

export default router;
