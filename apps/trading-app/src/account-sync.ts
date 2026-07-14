import axios from 'axios';
import type { FubonClient, AccountInfo } from './fubon-client';

// How often to refresh the live account snapshot. Balances "fresh enough to
// resolve an 'ALL' order correctly" against not hammering the Fubon API.
const POLL_INTERVAL_MS = 15000;

let cached: AccountInfo | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;

// A Fubon SDK accounting panic (see python/fubon_bridge.py) can poison an
// internal Rust mutex, after which every subsequent accounting call fails
// for the rest of that bridge process's life — so past this many
// back-to-back failures, further polling is pure log spam. Stops until the
// next startAccountSync() (i.e. the next successful reconnect).
const MAX_CONSECUTIVE_FAILURES = 3;

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
    consecutiveFailures = 0;
    await axios.post(
      `${serverUrl}/api/trading-app/account`,
      { cash: cached.cash, positions: cached.positions },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (err) {
    console.warn('[Account] 更新帳戶資訊失敗:', err instanceof Error ? err.message : err);
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && timer) {
      clearInterval(timer);
      timer = null;
      console.error(
        `[Account] 連續 ${MAX_CONSECUTIVE_FAILURES} 次更新失敗，已停止自動同步（富邦 SDK 可能已進入異常狀態）。'ALL' 數量的訊號將以 0 股處理，請中斷並重新連線以恢復。`,
      );
    }
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
  consecutiveFailures = 0;
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
