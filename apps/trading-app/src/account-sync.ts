import axios from 'axios';
import type { FubonClient, AccountInfo } from './fubon-client';

// How often to refresh the live account snapshot. Balances "fresh enough to
// resolve an 'ALL' order correctly" against not hammering the Fubon API.
const POLL_INTERVAL_MS = 15000;

let cached: AccountInfo | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * The freshest known account snapshot — a plain RAM read, never a network call.
 * This is what `'ALL'` quantity resolution and any local account display read
 * from, so confirming a pending order never waits on Fubon or the AI股探 server.
 */
export function getCachedAccount(): AccountInfo | null {
  return cached;
}

async function pollOnce(fubon: FubonClient, serverUrl: string, token: string): Promise<void> {
  try {
    cached = await fubon.getAccountInfo();
    await axios.post(
      `${serverUrl}/api/trading-app/account`,
      { cash: cached.cash, positions: cached.positions },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (err) {
    console.warn('[Account] 更新帳戶資訊失敗:', err instanceof Error ? err.message : err);
  }
}

/**
 * Starts polling the live Fubon account (cash + positions) into a RAM cache and
 * pushing each snapshot to the AI股探 server. The server-side copy is what
 * get_position()/get_cash() read from during rule evaluation (see
 * apps/api/src/index.ts); the RAM copy here is what 'ALL' quantity resolution
 * reads from locally, right before an order is actually sent.
 */
export function startAccountSync(fubon: FubonClient, serverUrl: string, token: string): void {
  stopAccountSync();
  pollOnce(fubon, serverUrl, token); // don't wait a full interval for the first snapshot
  timer = setInterval(() => pollOnce(fubon, serverUrl, token), POLL_INTERVAL_MS);
}

export function stopAccountSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  cached = null;
}
