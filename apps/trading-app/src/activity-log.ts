import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import type { TaiwanMarketType, TaiwanPriceType, TaiwanTimeInForce } from './market-session';

export interface LocalActivityEntry {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  status: 'FILLED' | 'FAILED' | 'SIMULATED' | 'REJECTED';
  orderId: string | null;
  message: string;
  source: 'LIVE' | 'SIMULATION';
  ruleName?: string;
  /** Ms from signal-triggered to order-sent (includes user confirmation time). Null for REJECTED — no order was ever sent. */
  latencyMs: number | null;
  /** Resolved Taiwan order routing actually used. Absent for REJECTED (no order was ever routed/sent). */
  marketType?: TaiwanMarketType;
  priceType?: TaiwanPriceType;
  timeInForce?: TaiwanTimeInForce;
  limitPrice?: number | null;
  createdAt: string;
}

const LOG_DIR = path.join(os.homedir(), '.stock-notifier-trader');
const LOG_PATH = path.join(LOG_DIR, 'activity.log');

/** Appends one JSON-line record to the local activity log — the user's own offline record. */
export function appendLocalActivity(entry: LocalActivityEntry): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

/** Reads the last `count` entries from the local activity log, oldest first. */
export function readRecentLocalActivity(count = 10): LocalActivityEntry[] {
  try {
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-count).map((line) => JSON.parse(line) as LocalActivityEntry);
  } catch {
    return [];
  }
}

/** Reports a trade outcome to the AI股探 server so it shows up on the web dashboard. Never sends Fubon credentials — only the trade outcome. */
export async function reportActivity(
  serverUrl: string,
  token: string,
  entry: {
    ruleId?: string;
    ruleName?: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    status: 'FILLED' | 'FAILED' | 'SIMULATED' | 'REJECTED';
    orderId?: string | null;
    message?: string;
    source: 'LIVE' | 'SIMULATION';
    latencyMs?: number | null;
    marketType?: TaiwanMarketType;
    priceType?: TaiwanPriceType;
    timeInForce?: TaiwanTimeInForce;
    limitPrice?: number;
  },
): Promise<void> {
  try {
    await axios.post(
      `${serverUrl}/api/trading-app/activity`,
      { ...entry, orderId: entry.orderId ?? undefined },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (err) {
    console.warn('[Activity] 回報交易活動至伺服器失敗（不影響本機交易）:', err instanceof Error ? err.message : err);
  }
}
