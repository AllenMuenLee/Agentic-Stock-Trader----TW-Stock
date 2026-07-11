// Surfaces any uncaught JS error directly on the page — registered first so it
// catches errors thrown by the rest of this script's own top-level code too.
// Without this, a single bad element lookup below would silently kill every
// listener in this file with nothing visible to the user.
window.addEventListener('error', (e) => {
  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;' +
    'color:#fecaca;padding:10px 14px;font:12px monospace;white-space:pre-wrap;';
  banner.textContent = `⚠ JS 錯誤：${e.message}（${e.filename?.split('/').pop()}:${e.lineno}）`;
  document.body.prepend(banner);
});

const $ = (id) => document.getElementById(id);

const loginForm = $('loginForm');
const connectedPanel = $('connectedPanel');
const connectStatus = $('connectStatus');
const simulateCheckbox = $('simulate');
const connectBtn = $('connectBtn');
const disconnectBtn = $('disconnectBtn');
const fubonFields = $('fubonFields');

// Simulation mode uses a bundled test account/certificate — the server
// derives it entirely on its own, so none of these fields are needed or shown.
simulateCheckbox.addEventListener('change', () => {
  fubonFields.classList.toggle('hidden', simulateCheckbox.checked);
});

// Shown the instant the button is clicked, before any network round-trip —
// so there's always an immediate, visible reaction to the click itself.
function showConnecting() {
  connectStatus.className = 'status-pill status-pill-warn';
  connectStatus.textContent = '🔄 連線中，請稍候…（登入 AI股探 → 登入富邦 → 建立訊號連線）';
}
function showError(msg) {
  connectStatus.className = 'status-pill status-pill-error';
  connectStatus.textContent = `❌ 登入失敗：${msg}`;
}
function clearConnectStatus() {
  connectStatus.className = 'status-pill hidden';
  connectStatus.textContent = '';
}

function renderConnected(status) {
  loginForm.classList.add('hidden');
  connectedPanel.classList.remove('hidden');
  $('modeLabel').textContent = status.simulate ? '富邦模擬交易環境' : '富邦真實交易環境';
  $('usernameLabel').textContent = status.aiUsername || '';

  const socketBadge = $('socketStatusBadge');
  socketBadge.classList.remove('status-pill-ok', 'status-pill-warn', 'status-pill-error');
  if (status.socketStatus === 'connected') {
    socketBadge.classList.add('status-pill-ok');
    socketBadge.textContent = '🟢 已連線';
  } else if (status.socketStatus === 'error') {
    socketBadge.classList.add('status-pill-error');
    socketBadge.textContent = `🔴 中斷${status.socketDetail ? `（${status.socketDetail}）` : ''}`;
  } else {
    socketBadge.classList.add('status-pill-warn');
    socketBadge.textContent = '🟡 連線中…';
  }
}

function renderDisconnected() {
  loginForm.classList.remove('hidden');
  connectedPanel.classList.add('hidden');
}

async function loadStatus() {
  const res = await fetch('/api/status');
  const status = await res.json();
  $('serverUrl').value = status.serverUrl;
  if (status.connected) renderConnected(status);
  else renderDisconnected();
  return status;
}

async function loadDefaults() {
  const res = await fetch('/api/defaults');
  const defaults = await res.json();
  if (defaults.fubonId) $('fubonId').value = defaults.fubonId;
  if (defaults.fubonCertPath) $('fubonCertPath').value = defaults.fubonCertPath;
}

/** Formats a latency in ms as e.g. "1.2s" or "850ms"; "—" when unknown (e.g. rejected orders). */
function formatLatency(latencyMs) {
  if (latencyMs == null) return '—';
  if (latencyMs < 1000) return `${latencyMs}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
}

const MARKET_TYPE_LABEL = { Common: '整股', Odd: '零股', Fixing: '盤後定價' };
const PRICE_TYPE_LABEL = { Limit: '限價', Market: '市價' };

/** Formats resolved Taiwan order routing as e.g. "整股·限價·ROD@620"; "—" when not (yet) resolved. */
function formatRouting(marketType, priceType, timeInForce, limitPrice) {
  if (!marketType || !priceType || !timeInForce) return '—';
  const parts = [MARKET_TYPE_LABEL[marketType] || marketType, PRICE_TYPE_LABEL[priceType] || priceType, timeInForce];
  const label = parts.join('·');
  return priceType === 'Limit' && limitPrice != null ? `${label}@${limitPrice}` : label;
}

function statusBadgeClass(status) {
  if (status === 'FILLED') return 'status-badge status-filled';
  if (status === 'SIMULATED') return 'status-badge status-simulated';
  if (status === 'REJECTED') return 'status-badge status-rejected';
  return 'status-badge status-failed';
}

async function loadActivity() {
  const res = await fetch('/api/activity');
  const activity = await res.json();
  const tbody = $('activityBody');
  const empty = $('activityEmpty');
  tbody.innerHTML = '';

  if (activity.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const a of activity) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(a.createdAt).toLocaleString()}</td>
      <td class="${a.side === 'BUY' ? 'side-buy' : 'side-sell'}">${a.side}</td>
      <td>${a.symbol}</td>
      <td>${a.quantity}</td>
      <td>${formatRouting(a.marketType, a.priceType, a.timeInForce, a.limitPrice)}</td>
      <td><span class="${statusBadgeClass(a.status)}">${a.status}</span></td>
      <td class="${a.source === 'SIMULATION' ? 'source-sim' : ''}">${a.source === 'SIMULATION' ? '模擬' : '實盤'}</td>
      <td>${a.ruleName || ''}</td>
      <td>${formatLatency(a.latencyMs)}</td>
    `;
    tbody.appendChild(tr);
  }
}

const pendingSection = $('pendingSection');
const pendingList = $('pendingList');
// Tracks buttons currently mid-request so a slow response can't be double-clicked.
const pendingInFlight = new Set();

async function respondToPendingOrder(id, action) {
  if (pendingInFlight.has(id)) return;
  pendingInFlight.add(id);
  try {
    const res = await fetch(`/api/pending-orders/${id}/${action}`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || (action === 'confirm' ? '下單失敗' : '操作失敗'));
    }
  } catch {
    alert('連線失敗，請確認程式是否仍在執行');
  } finally {
    pendingInFlight.delete(id);
    loadPendingOrders();
    loadActivity();
  }
}

async function loadPendingOrders() {
  const res = await fetch('/api/pending-orders');
  const orders = await res.json();

  pendingSection.classList.toggle('hidden', orders.length === 0);
  pendingList.innerHTML = '';

  for (const o of orders) {
    // orderAllowed is only ever a firm rejection for a concrete (non-'ALL')
    // quantity — 'ALL' orders show routing as unresolved ("—") until confirmed,
    // since the real quantity (and therefore market segment) isn't known yet.
    const blocked = o.orderAllowed === false;
    const card = document.createElement('div');
    card.className = 'pending-card';
    card.innerHTML = `
      <div class="pending-top">
        <span class="pulse"></span>
        <span class="${o.signal === 'BUY' ? 'side-buy' : 'side-sell'}">${o.signal}</span>
        <span>${o.symbol}</span>
        <span>x${o.quantity === 'ALL' ? '全部' : o.quantity}</span>
        <span>@ ${o.price}</span>
        <span>${formatRouting(o.marketType, o.priceType, o.timeInForce, o.limitPrice)}</span>
        <span style="margin-left:auto;color:var(--muted);font-size:0.75rem">${o.ruleName || ''}</span>
      </div>
      <p class="pending-message">${o.message}</p>
      ${blocked ? `<p class="pending-warning">⚠ ${o.orderNote || '目前無法送出委託'}</p>` : ''}
      <div class="pending-actions">
        <button class="btn-confirm" data-action="confirm" ${blocked ? 'disabled title="目前非有效交易時段，無法下單"' : ''}>確認下單</button>
        <button class="btn-reject" data-action="reject">拒絕</button>
      </div>
    `;
    if (!blocked) {
      card.querySelector('[data-action="confirm"]').addEventListener('click', () => respondToPendingOrder(o.id, 'confirm'));
    }
    card.querySelector('[data-action="reject"]').addEventListener('click', () => respondToPendingOrder(o.id, 'reject'));
    pendingList.appendChild(card);
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Manual validation (the form has novalidate) so an incomplete form always
  // produces a visible, immediate reaction — native browser validation can
  // silently block the submit event with an easy-to-miss tooltip instead.
  const aiUsername = $('aiUsername').value.trim();
  const aiPassword = $('aiPassword').value;
  const simulate = simulateCheckbox.checked;

  if (!aiUsername || !aiPassword) {
    showError('請輸入 AI股探 帳號與密碼');
    return;
  }

  let fubonBody = {};
  if (!simulate) {
    const fubonId = $('fubonId').value.trim();
    const fubonPassword = $('fubonPassword').value;
    const fubonCertPath = $('fubonCertPath').value.trim();
    const fubonCertPassword = $('fubonCertPassword').value;
    if (!fubonId || !fubonPassword || !fubonCertPath || !fubonCertPassword) {
      showError('請完整輸入富邦帳號、密碼、憑證路徑與憑證密碼（或改用模擬交易環境）');
      return;
    }
    fubonBody = { fubonId, fubonPassword, fubonCertPath, fubonCertPassword };
  }

  // Everything below happens synchronously before the network call — so the
  // click always produces an immediate, visible reaction no matter how long
  // /api/connect ends up taking (real Fubon login can take several seconds).
  showConnecting();
  connectBtn.disabled = true;
  connectBtn.textContent = '連線中…';
  loginForm.classList.add('form-loading');

  const body = { aiUsername, aiPassword, simulate, ...fubonBody };

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || '連線失敗');
      return;
    }
    clearConnectStatus();
    // Fetch the authoritative status rather than trusting the connect response —
    // the socket.io handshake is still in flight at this point, so the real
    // socketStatus only shows up once /api/status is polled.
    await loadStatus();
    loadActivity();
  } catch {
    showError('連線失敗，請確認伺服器是否可連線');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = '連線並開始監聽訊號';
    loginForm.classList.remove('form-loading');
  }
});

disconnectBtn.addEventListener('click', async () => {
  disconnectBtn.disabled = true;
  try {
    await fetch('/api/disconnect', { method: 'POST' });
  } finally {
    disconnectBtn.disabled = false;
    renderDisconnected();
  }
});

loadStatus();
loadDefaults();
loadActivity();
loadPendingOrders();
setInterval(loadActivity, 3000);
setInterval(loadStatus, 2000); // fast enough to show the socket handshake resolving promptly
setInterval(loadPendingOrders, 2000); // time-sensitive — poll faster than activity
