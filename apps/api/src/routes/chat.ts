import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from '../services/gemini.service';
import { requireAuth } from '../middleware/auth';
import { UsageService } from '../services/usage.service';
import type { ChatMessage } from '@stock-notifier/shared';

const router = Router();
const prisma = new PrismaClient();
const usage = new UsageService(prisma);

router.use(requireAuth);

const gemini = new GeminiService(
  process.env.GOOGLE_API_KEY || '',
  process.env.GOOGLE_MODEL,
);

// GET /api/chat — list this user's own sessions with preview + connected rule
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionGroups = await prisma.chatMessage.groupBy({
      by: ['sessionId'],
      where: { userId: req.user!.id },
      _count: { id: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });

    if (!sessionGroups.length) { res.json([]); return; }

    const sessionIds = sessionGroups.map((s) => s.sessionId);

    // First user message per session as preview text
    const firstMessages = await prisma.chatMessage.findMany({
      where: { sessionId: { in: sessionIds }, userId: req.user!.id, role: 'user' },
      orderBy: { createdAt: 'asc' },
      distinct: ['sessionId'],
      select: { sessionId: true, content: true },
    });
    const previewBySession = new Map<string, string>(firstMessages.map((m) => [m.sessionId, m.content]));

    // Rules connected to these sessions
    const rules = await prisma.rule.findMany({
      where: { sessionId: { in: sessionIds }, userId: req.user!.id },
      select: { id: true, name: true, sessionId: true, isActive: true, poolType: true },
    });
    const ruleBySession = new Map(rules.map((r) => [r.sessionId!, r]));

    res.json(
      sessionGroups.map((s) => ({
        sessionId: s.sessionId,
        messageCount: s._count.id,
        createdAt: s._min.createdAt,
        updatedAt: s._max.createdAt,
        preview: (previewBySession.get(s.sessionId) ?? '').slice(0, 120),
        rule: ruleBySession.get(s.sessionId) ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/:sessionId — fetch conversation history (only if it belongs to the caller)
router.get('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.sessionId, userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/:sessionId — send a message (streaming SSE)
router.post('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  const { sessionId } = req.params;
  const { message } = req.body as { message: string };

  console.log(`[Chat] Received message for session: ${sessionId}`);

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const quota = await usage.consumeQuota(req.user!.id, 'chat');
  if (!quota.ok) {
    res.status(403).json({
      error: `已達 ${quota.planName} 每日對話次數上限（${quota.limit} 次），請升級方案或明天再試`,
      code: 'LIMIT_EXCEEDED',
      limit: quota.limit,
      planId: quota.planId,
    });
    return;
  }

  let headersSet = false;

  try {
    // Save user message and load history before opening SSE stream so that
    // any Prisma failure here still returns a normal HTTP error (not ECONNRESET)
    await prisma.chatMessage.create({
      data: { sessionId, userId: req.user!.id, role: 'user', content: message },
    });

    const history = await prisma.chatMessage.findMany({
      where: { sessionId, userId: req.user!.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const chatMessages: ChatMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Open SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    headersSet = true;

    const result = await gemini.chat(chatMessages, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    });

    // Save assistant response
    await prisma.chatMessage.create({
      data: { sessionId, userId: req.user!.id, role: 'assistant', content: result.content },
    });

    if (result.ruleConfig) {
      res.write(`data: ${JSON.stringify({ type: 'rule', data: result.ruleConfig })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Chat] Error:', err);
    if (headersSet) {
      // SSE stream already open — send an error event then close
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get AI response' })}\n\n`);
      res.end();
    } else {
      next(err);
    }
  }
});

// DELETE /api/chat/:sessionId — clear conversation (only the caller's own)
router.delete('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.chatMessage.deleteMany({ where: { sessionId: req.params.sessionId, userId: req.user!.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
