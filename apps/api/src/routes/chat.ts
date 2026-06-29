import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from '../services/gemini.service';
import type { ChatMessage } from '@stock-notifier/shared';

const router = Router();
const prisma = new PrismaClient();
const gemini = new GeminiService(
  process.env.GOOGLE_API_KEY || '',
  process.env.GOOGLE_MODEL,
);

// GET /api/chat/:sessionId — fetch conversation history
router.get('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.sessionId },
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

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  let headersSet = false;

  try {
    // Save user message and load history before opening SSE stream so that
    // any Prisma failure here still returns a normal HTTP error (not ECONNRESET)
    await prisma.chatMessage.create({
      data: { sessionId, role: 'user', content: message },
    });

    const history = await prisma.chatMessage.findMany({
      where: { sessionId },
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
      data: { sessionId, role: 'assistant', content: result.content },
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

// DELETE /api/chat/:sessionId — clear conversation
router.delete('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.chatMessage.deleteMany({ where: { sessionId: req.params.sessionId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
