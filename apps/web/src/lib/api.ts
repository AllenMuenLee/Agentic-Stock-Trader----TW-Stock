const BASE = '/api';

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  // Chat
  getMessages: (sessionId: string) => fetchJson(`/chat/${sessionId}`),
  clearChat: (sessionId: string) =>
    fetchJson(`/chat/${sessionId}`, { method: 'DELETE' }),

  // Rules
  getRules: () => fetchJson('/rules'),
  createRule: (data: unknown) =>
    fetchJson('/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateRule: (id: string, data: { code?: string; poolType?: string; poolFilterCode?: string | null; symbols?: string[] }) =>
    fetchJson(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  toggleRule: (id: string) =>
    fetchJson(`/rules/${id}/toggle`, { method: 'PATCH' }),
  deleteRule: (id: string) =>
    fetchJson(`/rules/${id}`, { method: 'DELETE' }),
  backtestRule: (id: string, options: { startDate?: string; endDate?: string } | number = 30) =>
    fetchJson(`/rules/${id}/backtest`, {
      method: 'POST',
      body: JSON.stringify(typeof options === 'number' ? { days: options } : options),
    }),
  getRuleAvailableDates: (id: string) =>
    fetchJson<{ minDate: string | null; maxDate: string | null }>(`/rules/${id}/available-dates`),
  getRuleTriggers: (id: string) => fetchJson(`/rules/${id}/triggers`),

  // Settings
  getSettings: () => fetchJson('/settings'),
  updateSettings: (data: unknown) =>
    fetchJson('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  testNotification: (channel: string) =>
    fetchJson('/settings/test-notification', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),

  // Stocks
  getQuote: (symbol: string) => fetchJson(`/stocks/quote/${symbol}`),
  getHistory: (symbol: string, days = 30) =>
    fetchJson(`/stocks/history/${symbol}?days=${days}`),
};
