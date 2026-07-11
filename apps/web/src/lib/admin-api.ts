import { BASE } from './api';

// Deliberately separate from lib/api.ts's fetchJson: the admin session uses its
// own token (a different localStorage key) so it never collides with, or is
// confused for, a regular user session.
const ADMIN_TOKEN_KEY = 'admin_token';

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function fetchAdminJson<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAdminToken();
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

export interface AdminStats {
  totalUsers: number;
  preRegistered: { PLAN_399: number; PLAN_799: number };
  monitoredStocks: string[];
  subscriptionBreakdown: { websocket: string[]; restPolling: string[] };
}

export const adminApi = {
  login: (password: string) =>
    fetchAdminJson<{ token: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
  getStats: () => fetchAdminJson<AdminStats>('/admin/stats'),
};
