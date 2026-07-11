import type { PlanStatus, TradeActivityDto } from '@stock-notifier/shared';

export const BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api`;

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

/** Extracts the server's `{ error: "..." }` message from a fetchJson-thrown Error, falling back to `fallback` when the body wasn't JSON or had no `error` field. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    try {
      const jsonPart = err.message.slice(err.message.indexOf('{'));
      const body = JSON.parse(jsonPart) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // non-JSON error body — keep default message
    }
  }
  return fallback;
}

export const api = {
  // Auth
  updatePassword: (data: { currentPassword: string; newPassword: string }) =>
    fetchJson('/auth/password', { method: 'PATCH', body: JSON.stringify(data) }),
  verifyEmail: (token: string) =>
    fetchJson<{ ok: boolean; message: string }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  resendVerification: (email: string) =>
    fetchJson<{ message: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

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
  backtestRule: (id: string, options: { startDate?: string; endDate?: string } | number = 30, principal?: number) =>
    fetchJson(`/rules/${id}/backtest`, {
      method: 'POST',
      body: JSON.stringify({ ...(typeof options === 'number' ? { days: options } : options), principal }),
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
  getDiscordGuildStatus: () =>
    fetchJson<{ joined: boolean; inviteUrl: string | null }>('/bind/discord/guild-status'),

  // Stocks
  getQuote: (symbol: string) => fetchJson(`/stocks/quote/${symbol}`),
  getHistory: (symbol: string, days = 30) =>
    fetchJson(`/stocks/history/${symbol}?days=${days}`),

  // Plans
  getPlanStatus: () => fetchJson<PlanStatus>('/plans/me'),
  switchPlan: (planId: string) =>
    fetchJson<PlanStatus>('/plans/switch', { method: 'POST', body: JSON.stringify({ planId }) }),
  preRegisterPlan: (planId: string) =>
    fetchJson<PlanStatus>('/plans/pre-register', { method: 'POST', body: JSON.stringify({ planId }) }),
  cancelPreRegistration: () =>
    fetchJson<PlanStatus>('/plans/pre-register', { method: 'DELETE' }),

  // Trading app activity — trades executed locally by the trading-app CLI
  getTradingActivity: () => fetchJson<TradeActivityDto[]>('/trading-app/activity'),

  // Trading app download — needs the Authorization header, so a plain <a href>
  // won't work; fetch as a blob and trigger a synthetic download instead.
  downloadTradingApp: async (): Promise<void> => {
    const token = getToken();
    const res = await fetch(`${BASE}/trading-app/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = '下載失敗，請稍後再試';
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock-notifier-trading-app.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
