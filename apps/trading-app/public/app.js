const $ = (id) => document.getElementById(id);

const loginForm = $('loginForm');
const connectedPanel = $('connectedPanel');
const loginError = $('loginError');
const simulateCheckbox = $('simulate');
const connectBtn = $('connectBtn');
const disconnectBtn = $('disconnectBtn');
const fubonFields = $('fubonFields');

// Simulation mode uses a bundled test account/certificate — the server
// derives it entirely on its own, so none of these fields are needed or shown.
simulateCheckbox.addEventListener('change', () => {
  fubonFields.classList.toggle('hidden', simulateCheckbox.checked);
});

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function clearError() {
  loginError.classList.add('hidden');
  loginError.textContent = '';
}

function renderConnected(status) {
  loginForm.classList.add('hidden');
  connectedPanel.classList.remove('hidden');
  $('modeLabel').textContent = status.simulate ? '富邦模擬交易環境' : '富邦真實交易環境';
  $('usernameLabel').textContent = status.aiUsername || '';
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
      <td><span class="${statusBadgeClass(a.status)}">${a.status}</span></td>
      <td class="${a.source === 'SIMULATION' ? 'source-sim' : ''}">${a.source === 'SIMULATION' ? '模擬' : '實盤'}</td>
      <td>${a.ruleName || ''}</td>
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
    const card = document.createElement('div');
    card.className = 'pending-card';
    card.innerHTML = `
      <div class="pending-top">
        <span class="pulse"></span>
        <span class="${o.signal === 'BUY' ? 'side-buy' : 'side-sell'}">${o.signal}</span>
        <span>${o.symbol}</span>
        <span>x${o.quantity}</span>
        <span>@ ${o.price}</span>
        <span style="margin-left:auto;color:var(--muted);font-size:0.75rem">${o.ruleName || ''}</span>
      </div>
      <p class="pending-message">${o.message}</p>
      <div class="pending-actions">
        <button class="btn-confirm" data-action="confirm">確認下單</button>
        <button class="btn-reject" data-action="reject">拒絕</button>
      </div>
    `;
    card.querySelector('[data-action="confirm"]').addEventListener('click', () => respondToPendingOrder(o.id, 'confirm'));
    card.querySelector('[data-action="reject"]').addEventListener('click', () => respondToPendingOrder(o.id, 'reject'));
    pendingList.appendChild(card);
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  connectBtn.disabled = true;
  connectBtn.textContent = '連線中…';

  const body = {
    aiUsername: $('aiUsername').value.trim(),
    aiPassword: $('aiPassword').value,
    simulate: simulateCheckbox.checked,
    // Omitted entirely when simulate is checked — the server derives the whole
    // Fubon login (account, password, cert, cert password) from its bundled test account.
    ...(simulateCheckbox.checked ? {} : {
      fubonId: $('fubonId').value.trim(),
      fubonPassword: $('fubonPassword').value,
      fubonCertPath: $('fubonCertPath').value.trim(),
      fubonCertPassword: $('fubonCertPassword').value,
    }),
  };

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
    renderConnected({ simulate: data.simulate, aiUsername: body.aiUsername });
    loadActivity();
  } catch {
    showError('連線失敗，請確認伺服器是否可連線');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = '連線並開始監聽訊號';
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
setInterval(loadStatus, 5000);
setInterval(loadPendingOrders, 2000); // time-sensitive — poll faster than activity
