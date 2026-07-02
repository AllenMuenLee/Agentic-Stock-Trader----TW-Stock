const BASE = '/api';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  updatePassword: (data: { currentPassword: string; newPassword: string }) =>
    fetchJson('/auth/password', { method: 'PATCH', body: JSON.stringify(data) }),

  // Chat
  getChatSessions: () => fetchJson<{
    sessionId: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
    preview: string;
    rule: { id: string; name: string; isActive: boolean; poolType: string } | null;
  }[]>('/chat'),
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
  getSettings: () => fetchJson<{ email: string | null; lineUserId: string | null; discordUserId: string | null }>('/settings'),
  updateSettings: (data: { email?: string }) =>
    fetchJson('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  testNotification: (channel: string) =>
    fetchJson('/settings/test-notification', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),

  // LINE binding
  getLineCode: () =>
    fetchJson<{ code: string; expiry: string; lineUserId: string | null; qrCodeUrl: string | null; botBasicId: string }>('/bind/line/code'),
  unbindLine: () =>
    fetchJson('/bind/line/unbind', { method: 'POST' }),

  // Discord binding
  getDiscordUrl: () =>
    fetchJson<{ url: string; discordUserId: string | null }>('/bind/discord/url'),
  unbindDiscord: () =>
    fetchJson('/bind/discord/unbind', { method: 'POST' }),

  // Stocks
  getQuote: (symbol: string) => fetchJson(`/stocks/quote/${symbol}`),
  getHistory: (symbol: string, days = 30) =>
    fetchJson(`/stocks/history/${symbol}?days=${days}`),
};
