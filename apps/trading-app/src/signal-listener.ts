import { io, Socket } from 'socket.io-client';

export interface SignalEvent {
  ruleId: string;
  ruleName: string;
  triggerId: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'NOTIFY';
  price: number;
  /** Suggested order size in shares, decided by the rule's own AI-generated code. Null for NOTIFY. */
  quantity: number | null;
  message: string;
  triggeredAt: string;
}

/** Connects to the AI股探 server's per-user socket room and forwards only BUY/SELL signals — NOTIFY is alert-only and never triggers a trade. */
export function connectSignalListener(
  serverUrl: string,
  token: string,
  onTradeSignal: (event: SignalEvent) => void,
): Socket {
  const socket = io(serverUrl, {
    auth: { token: `Bearer ${token}` },
    transports: ['websocket'],
  });

  socket.on('connect', () => console.log(`[Signal] 已連線至 ${serverUrl}`));
  socket.on('connect_error', (err: Error) => console.error('[Signal] 連線失敗:', err.message));
  socket.on('disconnect', (reason: string) => console.warn(`[Signal] 連線中斷: ${reason}`));

  socket.on('notification', (event: SignalEvent) => {
    if (event.signal === 'BUY' || event.signal === 'SELL') {
      onTradeSignal(event);
    }
  });

  return socket;
}
