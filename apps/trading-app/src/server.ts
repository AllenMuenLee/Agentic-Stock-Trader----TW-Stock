import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { Socket } from 'socket.io-client';
import { loadConfig, saveConfig, clearSavedSession } from './config';
import { loginToServer, verifyToken } from './server-auth';
import { connectSignalListener, SignalEvent, SocketStatus } from './signal-listener';
import { FubonClient } from './fubon-client';
import { appendLocalActivity, readRecentLocalActivity, reportActivity } from './activity-log';
import type { TradeOrder } from './trade-order';
import { startAccountSync, stopAccountSync, getCachedAccount } from './account-sync';
import { openBrowser } from './open-browser';
import { resolveOrderRouting } from './market-session';

// The AI股探 server address is an operator setting, not something the end user
// should ever type in — it comes from the environment only.
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const UI_PORT = Number(process.env.PORT) || 4321;

// Only used if a signal somehow arrives without a quantity (should not happen —
// the AI-generated rule code is instructed to always include one for trade rules).
const FALLBACK_QUANTITY = 1000; // 1 張

// Bundled Fubon simulation-environment test account. The cert file is kept
// outside public/ so it's never served over HTTP, only read directly off disk
// here. When simulate mode is on, ALL Fubon fields are auto-derived from
// these — nothing about the Fubon login is collected from the user.
const TEST_FUBON_ID = '41610792';
const TEST_FUBON_PASSWORD = '12345678';
const TEST_CERT_PATH = path.join(__dirname, '..', 'test-cert', '41610792.pfx');
const TEST_CERT_PASSWORD = '12345678';

// Last-resort safety net, not a substitute for catching errors at their
// source. This process holds live state (Fubon SDK session, socket.io
// connection, cached account snapshot) that's expensive to reconstruct, and
// the Fubon SDK has shown multiple distinct ways to reject/panic once its
// internal state gets poisoned (bank_remain, inventories, logout — see
// python/fubon_bridge.py). For a locally-run trading app, staying up and
// logging beats Node's default "crash the whole process" behavior on an
// unhandled rejection we didn't anticipate at some call site.
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal-avoided] Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
});

interface Session {
  token: string;
  socket: Socket;
  fubon: FubonClient;
  // Whether the Fubon account logged into is a Fubon-issued simulation ("模擬")
  // account. Fubon's own login call is identical either way (id/password/cert)
  // — this is purely a label the user attaches so trades are tagged correctly
  // in the local log and on the dashboard, not a different code path.
  simulate: boolean;
  aiUsername: string;
  // The connect HTTP request returns before the socket.io handshake actually
  // completes, so this tracks the real signal-feed state separately from
  // "session exists" (which only means Fubon/AI股探 login succeeded).
  socketStatus: SocketStatus;
  socketDetail: string | null;
}

let session: Session | null = null;

/** A signal arriving from the server is executed against Fubon immediately — no user confirmation step. */
function handleSignal(event: SignalEvent): void {
  if (!session) return;
  if (event.signal !== 'BUY' && event.signal !== 'SELL') return;

  const quantity = event.quantity ?? FALLBACK_QUANTITY;
  const order: TradeOrder = {
    ruleId: event.ruleId,
    ruleName: event.ruleName,
    symbol: event.symbol,
    signal: event.signal,
    quantity,
    price: event.price,
    // Preview only — the authoritative routing decision is recomputed fresh
    // against the actual send-time clock in executeOrder(), since a moment
    // may pass between the signal arriving and the order actually going out.
    marketType: event.marketType,
    priceType: event.priceType,
    timeInForce: event.timeInForce,
    limitPrice: event.limitPrice,
    message: event.message,
    triggeredAt: event.triggeredAt,
  };

  console.log(`[自動下單] ${order.signal} ${order.symbol} x${order.quantity} @ ${order.price} — ${order.message}`);
  executeOrder(order).catch((err) => {
    // executeOrder() already logged/reported the failure to the activity log —
    // this is just so a rejected promise here doesn't become an unhandled rejection.
    console.error(`[自動下單失敗] ${order.signal} ${order.symbol}:`, err instanceof Error ? err.message : err);
  });
}

/**
 * Resolves an 'ALL' quantity against the freshest locally-cached account
 * snapshot (see account-sync.ts) — never a fresh API call, so this never adds
 * latency to order placement. Returns 0 (and the caller treats that as "can't
 * place this order") when there's no snapshot yet or nothing to sell/spend.
 */
function resolveQuantity(order: TradeOrder): number {
  if (order.quantity !== 'ALL') return order.quantity;

  const account = getCachedAccount();
  if (!account) return 0;

  if (order.signal === 'SELL') {
    return account.positions.find((p) => p.symbol === order.symbol)?.quantity ?? 0;
  }

  // BUY 'ALL' = spend all available cash, rounded down to whole 張 (1000-share
  // lots), with a small buffer held back for commission/slippage.
  if (order.price <= 0) return 0;
  const lots = Math.floor((account.cash * 0.995) / order.price / 1000);
  return Math.max(0, lots * 1000);
}

/** Places the order with Fubon immediately on a BUY/SELL signal — no user confirmation step. */
async function executeOrder(order: TradeOrder): Promise<void> {
  const s = session;
  if (!s) throw new Error('尚未連線');

  const quantity = resolveQuantity(order);
  const latencyMs = Date.now() - new Date(order.triggeredAt).getTime();

  if (quantity <= 0) {
    const message = order.signal === 'SELL' ? '目前無持股可全部賣出' : '可用現金不足以買進整張股票';
    console.error(`[下單失敗] ${order.signal} ${order.symbol}: ${message}`);
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: 0, status: 'FAILED',
      orderId: null, message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, latencyMs, createdAt: new Date().toISOString(),
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: 0, price: order.price, status: 'FAILED', message,
      source: s.simulate ? 'SIMULATION' : 'LIVE', latencyMs,
    });
    throw new Error(message);
  }

  // Always recomputed fresh against the current wall-clock time, not reused from
  // the (possibly stale) preview on `order` — a moment can pass between the
  // signal firing and this actually running, and the trading session (market
  // open/closed, etc.) can change in between.
  const routing = resolveOrderRouting(quantity, Math.floor(Date.now() / 1000), order.price, {
    priceType: order.priceType ?? undefined,
    timeInForce: order.timeInForce ?? undefined,
    limitPrice: order.limitPrice ?? undefined,
  });

  if (!routing.allowed || !routing.marketType || !routing.priceType || !routing.timeInForce) {
    const message = routing.reason ?? '目前無法送出委託';
    console.error(`[下單失敗] ${order.signal} ${order.symbol}: ${message}`);
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: 0, status: 'FAILED',
      orderId: null, message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, latencyMs, createdAt: new Date().toISOString(),
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: 0, price: order.price, status: 'FAILED', message,
      source: s.simulate ? 'SIMULATION' : 'LIVE', latencyMs,
    });
    throw new Error(message);
  }

  try {
    const result = await s.fubon.placeOrder({
      symbol: order.symbol,
      side: order.signal === 'BUY' ? 'Buy' : 'Sell',
      quantity: routing.quantity,
      marketType: routing.marketType,
      priceType: routing.priceType,
      timeInForce: routing.timeInForce,
      limitPrice: routing.limitPrice,
    });
    console.log(`[下單成功] ${order.signal} ${order.symbol}`, result.raw ?? result);
    const status = s.simulate ? 'SIMULATED' : 'FILLED';
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: routing.quantity, status,
      orderId: result.orderId, message: order.message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, latencyMs, createdAt: new Date().toISOString(),
      marketType: routing.marketType, priceType: routing.priceType, timeInForce: routing.timeInForce, limitPrice: routing.limitPrice,
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: routing.quantity, price: order.price, status, orderId: result.orderId,
      message: order.message, source: s.simulate ? 'SIMULATION' : 'LIVE', latencyMs,
      marketType: routing.marketType, priceType: routing.priceType, timeInForce: routing.timeInForce,
      limitPrice: routing.limitPrice ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[下單失敗] ${order.signal} ${order.symbol}:`, message);
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: routing.quantity, status: 'FAILED',
      orderId: null, message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, latencyMs, createdAt: new Date().toISOString(),
      marketType: routing.marketType, priceType: routing.priceType, timeInForce: routing.timeInForce, limitPrice: routing.limitPrice,
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: routing.quantity, price: order.price, status: 'FAILED', message,
      source: s.simulate ? 'SIMULATION' : 'LIVE', latencyMs,
      marketType: routing.marketType, priceType: routing.priceType, timeInForce: routing.timeInForce,
      limitPrice: routing.limitPrice ?? undefined,
    });
    throw err;
  }
}

async function disconnectSession(): Promise<void> {
  if (!session) return;
  const { socket, fubon } = session;
  session = null;
  stopAccountSync();
  socket.disconnect();
  try {
    await fubon.logout();
  } catch (err) {
    // Once the Fubon SDK's internal state is poisoned (see the panic-recovery
    // notes in python/fubon_bridge.py and account-sync.ts), even logout()
    // can reject — that's not fatal here, we're tearing the session down
    // either way, so just log it instead of letting it propagate as an
    // unhandled rejection (which would crash the whole process; neither
    // caller of disconnectSession() — the /api/disconnect route nor the
    // SIGINT/SIGTERM shutdown handler — catches rejections from it).
    console.warn('[Fubon] 登出失敗（將直接關閉連線）:', err instanceof Error ? err.message : err);
  } finally {
    fubon.shutdown();
  }
}

interface ConnectBody {
  aiUsername: string;
  // Optional: omitted (or blank) to reuse a previously-saved AI股探 session
  // (see config.ts's aiToken) instead of logging in fresh — see /api/connect.
  aiPassword?: string;
  simulate: boolean;
  // All omitted by the UI when simulate is checked — the bundled test account is used instead.
  fubonId?: string;
  fubonPassword?: string;
  fubonCertPath?: string;
  fubonCertPassword?: string;
}

const app = express();
app.use(express.json());
// This is a local dev-facing UI that changes often — never let the browser
// cache a stale copy of index.html/app.js/style.css across restarts.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

app.get('/api/status', (_req, res) => {
  res.json({
    connected: session !== null,
    simulate: session?.simulate ?? null,
    aiUsername: session?.aiUsername ?? null,
    serverUrl: SERVER_URL,
    // Real signal-feed state — "connected" above only means Fubon/AI股探 login succeeded.
    socketStatus: session?.socketStatus ?? null,
    socketDetail: session?.socketDetail ?? null,
  });
});

app.get('/api/defaults', (_req, res) => {
  const saved = loadConfig();
  res.json({
    fubonId: saved.fubonId ?? '',
    fubonCertPath: saved.fubonCertPath ?? '',
    aiUsername: saved.aiUsername ?? '',
    // Whether a saved AI股探 session *might* be reusable — not yet verified
    // (that happens at /api/connect time). The UI uses this to skip asking
    // for AI股探 credentials entirely and log in with it automatically.
    hasSavedSession: !!(saved.aiUsername && saved.aiToken),
  });
});

// "Switch account" escape hatch — forgets the saved AI股探 session so the UI
// falls back to asking for fresh AI股探 credentials next time.
app.post('/api/forget-session', (_req, res) => {
  clearSavedSession();
  res.json({ ok: true });
});

app.get('/api/activity', (_req, res) => {
  res.json(readRecentLocalActivity(50).reverse());
});

app.post('/api/connect', async (req, res) => {
  if (session) {
    res.status(409).json({ error: '已連線中，請先中斷連線再重新連線' });
    return;
  }

  const body = req.body as ConnectBody;
  if (!body.aiUsername) {
    res.status(400).json({ error: '請輸入 AI股探 帳號' });
    return;
  }

  // Simulation connections always use the bundled Fubon test account and
  // certificate, regardless of whatever the form submitted for those fields.
  const fubonId = body.simulate ? TEST_FUBON_ID : body.fubonId;
  const fubonPassword = body.simulate ? TEST_FUBON_PASSWORD : body.fubonPassword;
  const fubonCertPath = body.simulate ? TEST_CERT_PATH : body.fubonCertPath;
  const fubonCertPassword = body.simulate ? TEST_CERT_PASSWORD : body.fubonCertPassword;
  if (!fubonId || !fubonPassword || !fubonCertPath || !fubonCertPassword) {
    res.status(400).json({ error: '請輸入富邦帳號、密碼、憑證路徑與憑證密碼' });
    return;
  }
  if (!fs.existsSync(fubonCertPath)) {
    res.status(400).json({ error: `找不到憑證檔案：${fubonCertPath}` });
    return;
  }

  // Session persistence: a blank password means "reuse the saved AI股探
  // session" (see config.ts's aiToken) instead of logging in fresh — so a
  // trading-app restart doesn't force retyping the AI股探 password every
  // time. The saved token is re-verified here (not just trusted) since it
  // may have expired (7-day lifetime) or been for a different account.
  let token: string;
  const saved = loadConfig();
  if (body.aiPassword) {
    try {
      token = await loginToServer(SERVER_URL, body.aiUsername, body.aiPassword);
    } catch {
      res.status(400).json({ error: 'AI股探 登入失敗，請確認帳號密碼是否正確' });
      return;
    }
  } else if (saved.aiUsername === body.aiUsername && saved.aiToken && (await verifyToken(SERVER_URL, saved.aiToken))) {
    token = saved.aiToken;
  } else {
    res.status(400).json({ error: '沒有可用的已儲存登入狀態（已過期或尚未登入過），請輸入 AI股探 密碼' });
    return;
  }

  const fubon = new FubonClient();
  try {
    await fubon.login({
      id: fubonId, password: fubonPassword, certPath: fubonCertPath, certPassword: fubonCertPassword,
      simulate: !!body.simulate,
    });
  } catch (err) {
    fubon.shutdown();
    res.status(400).json({ error: `富邦 Neo API 登入失敗：${err instanceof Error ? err.message : err}` });
    return;
  }

  // Only cache the real cert path for next time — the test cert is always
  // re-derived from TEST_CERT_PATH, never worth persisting. The AI股探
  // session (username + token) is always cached so the next restart can
  // skip AI股探 login regardless of simulate mode.
  if (!body.simulate) saveConfig({ fubonId, fubonCertPath });
  saveConfig({ aiUsername: body.aiUsername, aiToken: token });

  const socket = connectSignalListener(SERVER_URL, token, handleSignal, (status, detail) => {
    if (session) { session.socketStatus = status; session.socketDetail = detail; }
  });
  session = {
    token, socket, fubon, simulate: !!body.simulate, aiUsername: body.aiUsername,
    socketStatus: 'connecting', socketDetail: null,
  };
  startAccountSync(fubon, SERVER_URL, token);

  res.json({ ok: true, simulate: session.simulate, serverUrl: SERVER_URL });
});

app.post('/api/disconnect', async (_req, res) => {
  await disconnectSession();
  res.json({ ok: true });
});

const server = app.listen(UI_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${UI_PORT}`;
  console.log('=== AI股探 獨立交易應用程式 ===');
  console.log(`介面已啟動：${url}`);
  console.log('本程式僅在本機執行；富邦登入資訊與憑證只會保留在本機記憶體中，絕不會上傳至伺服器。');
  openBrowser(url);
});

const shutdown = () => {
  console.log('\n正在關閉...');
  disconnectSession().finally(() => {
    server.close(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
