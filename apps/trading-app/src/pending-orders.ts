import { randomUUID } from 'crypto';

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
  quantity: number;
  price: number;
  message: string;
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
