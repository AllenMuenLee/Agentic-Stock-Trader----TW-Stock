import { io, Socket } from 'socket.io-client';
import type { TaiwanMarketType, TaiwanPriceType, TaiwanTimeInForce } from './market-session';

export interface SignalEvent {
  ruleId: string;
  ruleName: string;
  triggerId: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'NOTIFY';
  price: number;
  /** Suggested order size in shares, decided by the rule's own AI-generated code. Null for NOTIFY. 'ALL' is unresolved — see pending-orders.ts. */
  quantity: number | 'ALL' | null;
  /**
   * Resolved Taiwan order routing from the server. Null on all four fields when
   * `quantity === 'ALL'` — this app resolves routing itself in `executeOrder()`
   * once the real quantity is known (see `resolveQuantity`/`resolveRouting` in server.ts).
   */
  marketType: TaiwanMarketType | null;
  priceType: TaiwanPriceType | null;
  timeInForce: TaiwanTimeInForce | null;
  limitPrice: number | null;
  orderAllowed: boolean;
  orderNote: string | null;
  message: string;
  triggeredAt: string;
}

export type SocketStatus = 'connecting' | 'connected' | 'error';

/**
 * Connects to the AI股探 server's per-user socket room and forwards only
 * BUY/SELL signals — NOTIFY is alert-only and never triggers a trade.
 *
 * The HTTP request that triggers this returns long before the socket.io
 * handshake actually completes, so `onStatusChange` is how the caller finds
 * out whether the signal feed is really live (as opposed to just "Fubon/AI股探
 * login succeeded").
 */
export function connectSignalListener(
  serverUrl: string,
  token: string,
  onTradeSignal: (event: SignalEvent) => void,
  onStatusChange?: (status: SocketStatus, detail: string | null) => void,
): Socket {
  const socket = io(serverUrl, {
    auth: { token: `Bearer ${token}` },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`[Signal] 已連線至 ${serverUrl}`);
    onStatusChange?.('connected', null);
  });
  socket.on('connect_error', (err: Error) => {
    console.error('[Signal] 連線失敗:', err.message);
    onStatusChange?.('error', err.message);
  });
  socket.on('disconnect', (reason: string) => {
    console.warn(`[Signal] 連線中斷: ${reason}`);
    onStatusChange?.('error', reason);
  });

  socket.on('notification', (event: SignalEvent) => {
    if (event.signal === 'BUY' || event.signal === 'SELL') {
      onTradeSignal(event);
    }
  });

  return socket;
}
