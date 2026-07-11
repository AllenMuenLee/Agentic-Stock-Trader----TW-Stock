import { randomUUID } from 'crypto';
import type { TaiwanMarketType, TaiwanPriceType, TaiwanTimeInForce } from './market-session';

/**
 * A BUY/SELL signal waiting on the user's explicit confirmation before any
 * order is placed. Kept in memory only — this is a single-user local app,
 * so there's no need for persistence beyond the process lifetime.
 */
export interface PendingOrder {
  id: string;
  ruleId: string;
  ruleName: string;
  symbol: string;
  signal: 'BUY' | 'SELL';
  /** 'ALL' is unresolved — resolved against the live account cache right before sending, in executeOrder(). */
  quantity: number | 'ALL';
  price: number;
  /**
   * Resolved Taiwan order routing from the server. Null on all four fields when
   * `quantity === 'ALL'` — `executeOrder()` resolves routing itself right before
   * sending, once the real quantity is known.
   */
  marketType: TaiwanMarketType | null;
  priceType: TaiwanPriceType | null;
  timeInForce: TaiwanTimeInForce | null;
  limitPrice: number | null;
  orderAllowed: boolean;
  orderNote: string | null;
  message: string;
  /** When the rule triggered on the server — the latency clock's start point. */
  triggeredAt: string;
  createdAt: string;
}

const pending = new Map<string, PendingOrder>();

export function addPendingOrder(order: Omit<PendingOrder, 'id' | 'createdAt'>): PendingOrder {
  const entry: PendingOrder = { ...order, id: randomUUID(), createdAt: new Date().toISOString() };
  pending.set(entry.id, entry);
  return entry;
}

export function listPendingOrders(): PendingOrder[] {
  return [...pending.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Removes and returns the pending order, or undefined if it's already been confirmed/rejected/expired. */
export function takePendingOrder(id: string): PendingOrder | undefined {
  const order = pending.get(id);
  if (order) pending.delete(id);
  return order;
}
