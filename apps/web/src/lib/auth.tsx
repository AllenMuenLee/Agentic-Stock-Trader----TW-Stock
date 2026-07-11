'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { BASE as API_BASE } from '@/lib/api';

interface User {
  id: string;
  username: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Registers the account (unverified) and sends a verification email — does NOT log the user in or return a token, since login is blocked until they verify. */
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ['/', '/login', '/register', '/docs', '/verify-email', '/admin'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const saveSession = useCallback((tok: string, u: User) => {
    localStorage.setItem('auth_token', tok);
    setToken(tok);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem('auth_token');
    if (!stored) {
      setLoading(false);
      if (!PUBLIC_PATHS.includes(pathname)) router.push('/login');
      return;
    }
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { id: string; username: string } | null) => {
        if (data) {
          setToken(stored);
          setUser({ id: data.id, username: data.username });
        } else {
          localStorage.removeItem('auth_token');
          if (!PUBLIC_PATHS.includes(pathname)) router.push('/login');
        }
      })
      .catch(() => {
        if (!PUBLIC_PATHS.includes(pathname)) router.push('/login');
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let msg = '登入失敗，請確認伺服器是否正在運行';
      let code: string | undefined;
      try {
        const body = await res.json();
        msg = body.error || msg;
        code = body.code;
      } catch { /* non-JSON error */ }
      // Attach `code` (e.g. 'EMAIL_NOT_VERIFIED') so the login page can offer a
      // resend-verification action — Error itself has no such field natively.
      throw Object.assign(new Error(msg), { code });
    }
    const { token: tok, user: u } = await res.json();
    saveSession(tok, u);
    router.push('/chat');
  }, [saveSession, router]);

  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let msg = '註冊失敗，請確認伺服器是否正在運行';
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
      throw new Error(msg);
    }
    // No token here — the account starts unverified and login is blocked until
    // the user clicks the emailed verification link. The register page shows
    // a "check your email" panel instead of redirecting.
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
