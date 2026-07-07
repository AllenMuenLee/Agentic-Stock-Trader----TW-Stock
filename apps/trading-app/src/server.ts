import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { Socket } from 'socket.io-client';
import { loadConfig, saveConfig } from './config';
import { loginToServer } from './server-auth';
import { connectSignalListener, SignalEvent } from './signal-listener';
import { FubonClient } from './fubon-client';
import { appendLocalActivity, readRecentLocalActivity, reportActivity } from './activity-log';
import { addPendingOrder, listPendingOrders, takePendingOrder, PendingOrder } from './pending-orders';
import { openBrowser } from './open-browser';

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
}

let session: Session | null = null;

/** A signal arriving from the server only ever queues a pending order — nothing is sent to Fubon until the user confirms it in the UI. */
function handleSignal(event: SignalEvent): void {
  if (!session) return;
  if (event.signal !== 'BUY' && event.signal !== 'SELL') return;

  const quantity = event.quantity ?? FALLBACK_QUANTITY;
  const order = addPendingOrder({
    ruleId: event.ruleId,
    ruleName: event.ruleName,
    symbol: event.symbol,
    signal: event.signal,
    quantity,
    price: event.price,
    message: event.message,
  });

  console.log(`[待確認] ${order.signal} ${order.symbol} x${order.quantity} @ ${order.price} — ${order.message}`);
}

/** Actually places the order with Fubon after the user confirms a pending order in the UI. */
async function executeOrder(order: PendingOrder): Promise<void> {
  const s = session;
  if (!s) throw new Error('尚未連線');

  try {
    const result = await s.fubon.placeOrder({
      symbol: order.symbol,
      side: order.signal === 'BUY' ? 'Buy' : 'Sell',
      quantity: order.quantity,
    });
    console.log(`[下單成功] ${order.signal} ${order.symbol}`, result.raw ?? result);
    const status = s.simulate ? 'SIMULATED' : 'FILLED';
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: order.quantity, status,
      orderId: result.orderId, message: order.message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, createdAt: new Date().toISOString(),
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: order.quantity, price: order.price, status, orderId: result.orderId,
      message: order.message, source: s.simulate ? 'SIMULATION' : 'LIVE',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[下單失敗] ${order.signal} ${order.symbol}:`, message);
    appendLocalActivity({
      symbol: order.symbol, side: order.signal, quantity: order.quantity, status: 'FAILED',
      orderId: null, message, source: s.simulate ? 'SIMULATION' : 'LIVE',
      ruleName: order.ruleName, createdAt: new Date().toISOString(),
    });
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: order.quantity, price: order.price, status: 'FAILED', message,
      source: s.simulate ? 'SIMULATION' : 'LIVE',
    });
    throw err;
  }
}

/** Records a user-declined signal as a REJECTED activity — no order is ever sent to Fubon. */
async function recordRejection(order: PendingOrder): Promise<void> {
  const s = session;
  const source = s?.simulate ? 'SIMULATION' : 'LIVE';
  appendLocalActivity({
    symbol: order.symbol, side: order.signal, quantity: order.quantity, status: 'REJECTED',
    orderId: null, message: order.message, source, ruleName: order.ruleName, createdAt: new Date().toISOString(),
  });
  if (s) {
    await reportActivity(SERVER_URL, s.token, {
      ruleId: order.ruleId, ruleName: order.ruleName, symbol: order.symbol, side: order.signal,
      quantity: order.quantity, price: order.price, status: 'REJECTED', message: order.message, source,
    });
  }
}

async function disconnectSession(): Promise<void> {
  if (!session) return;
  const { socket, fubon } = session;
  session = null;
  socket.disconnect();
  try {
    await fubon.logout();
  } finally {
    fubon.shutdown();
  }
}

interface ConnectBody {
  aiUsername: string;
  aiPassword: string;
  simulate: boolean;
  // All omitted by the UI when simulate is checked — the bundled test account is used instead.
  fubonId?: string;
  fubonPassword?: string;
  fubonCertPath?: string;
  fubonCertPassword?: string;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (_req, res) => {
  res.json({
    connected: session !== null,
    simulate: session?.simulate ?? null,
    aiUsername: session?.aiUsername ?? null,
    serverUrl: SERVER_URL,
  });
});

app.get('/api/defaults', (_req, res) => {
  const saved = loadConfig();
  res.json({ fubonId: saved.fubonId ?? '', fubonCertPath: saved.fubonCertPath ?? '' });
});

app.get('/api/activity', (_req, res) => {
  res.json(readRecentLocalActivity(50).reverse());
});

app.get('/api/pending-orders', (_req, res) => {
  res.json(listPendingOrders());
});

app.post('/api/pending-orders/:id/confirm', async (req, res) => {
  const order = takePendingOrder(req.params.id);
  if (!order) { res.status(404).json({ error: '此訂單已不存在（可能已被處理或已過期）' }); return; }

  try {
    await executeOrder(order);
    res.json({ ok: true });
  } catch (err) {
    // executeOrder already logged/reported the failure — just surface it to the UI.
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/pending-orders/:id/reject', async (req, res) => {
  const order = takePendingOrder(req.params.id);
  if (!order) { res.status(404).json({ error: '此訂單已不存在（可能已被處理或已過期）' }); return; }

  await recordRejection(order);
  res.json({ ok: true });
});

app.post('/api/connect', async (req, res) => {
  if (session) {
    res.status(409).json({ error: '已連線中，請先中斷連線再重新連線' });
    return;
  }

  const body = req.body as ConnectBody;
  if (!body.aiUsername || !body.aiPassword) {
    res.status(400).json({ error: '請輸入 AI股探 帳號與密碼' });
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

  let token: string;
  try {
    token = await loginToServer(SERVER_URL, body.aiUsername, body.aiPassword);
  } catch {
    res.status(400).json({ error: 'AI股探 登入失敗，請確認帳號密碼是否正確' });
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
  // re-derived from TEST_CERT_PATH, never worth persisting.
  if (!body.simulate) saveConfig({ fubonId, fubonCertPath });

  const socket = connectSignalListener(SERVER_URL, token, handleSignal);
  session = { token, socket, fubon, simulate: !!body.simulate, aiUsername: body.aiUsername };

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
