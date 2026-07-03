'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface User {
  id: string;
  username: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ['/', '/login', '/register', '/docs'];
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api`;

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

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let msg = '登入失敗，請確認伺服器是否正在運行';
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
      throw new Error(msg);
    }
    const { token: tok, user: u } = await res.json();
    saveSession(tok, u);
    router.push('/chat');
  }, [saveSession, router]);

  const register = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let msg = '註冊失敗，請確認伺服器是否正在運行';
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
      throw new Error(msg);
    }
    const { token: tok, user: u } = await res.json();
    saveSession(tok, u);
    router.push('/chat');
  }, [saveSession, router]);

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
