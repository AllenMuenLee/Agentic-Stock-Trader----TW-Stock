import type { TaiwanMarketType, TaiwanPriceType, TaiwanTimeInForce } from './market-session';

/** A BUY/SELL signal to execute immediately against Fubon — no user confirmation step. */
export interface TradeOrder {
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
  message: string;
  /** When the rule triggered on the server — the latency clock's start point. */
  triggeredAt: string;
}
