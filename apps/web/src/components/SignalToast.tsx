'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { TrendingUp, TrendingDown, X } from 'lucide-react';

interface SignalEvent {
  ruleId: string;
  ruleName: string;
  symbol: string;
  signal: 'BUY' | 'SELL';
  price: number;
  quantity: number | null;
  message: string;
  triggeredAt: string;
}

let socket: Socket | null = null;

export default function SignalToast() {
  const [toasts, setToasts] = useState<(SignalEvent & { id: string })[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001', {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
    });

    socket.on('signal', (event: SignalEvent) => {
      const id = `${event.ruleId}-${Date.now()}`;
      setToasts((prev) => [...prev.slice(-4), { ...event, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 8000);
    });

    return () => {
      socket?.disconnect();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`card p-3 shadow-lg border animate-in slide-in-from-right ${
            toast.signal === 'BUY' ? 'border-emerald-500/50' : 'border-red-500/50'
          }`}
        >
          <div className="flex items-start gap-2">
            {toast.signal === 'BUY' ? (
              <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span
                  className={`text-xs font-bold ${
                    toast.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {toast.signal}
                </span>
                <span className="text-slate-400 text-xs">·</span>
                <span className="text-slate-300 text-xs font-medium">{toast.symbol}</span>
                {toast.quantity !== null && (
                  <span className="text-slate-500 text-xs">x{toast.quantity}</span>
                )}
                <span className="text-slate-400 text-xs ml-auto">${toast.price}</span>
              </div>
              <p className="text-xs text-slate-500 truncate">{toast.ruleName}</p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-slate-600 hover:text-slate-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
