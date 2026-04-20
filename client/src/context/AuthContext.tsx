/**
 * AuthContext — the single source of truth for "is there a logged-in user."
 *
 * The JWT itself lives in an httpOnly cookie the browser attaches to every
 * request; this context only tracks whether we *have* a session and who
 * the user is. Never stores the token itself — that is forbidden by
 * CLAUDE.md section 10.
 *
 * State machine:
 *   unknown  → on mount, call GET /auth/me to probe the cookie.
 *   anonymous→ no user; LoginPage is the only reachable page.
 *   authenticated → user present; app routes unlock.
 *
 * The "unknown" state is important: without it, a refresh on a protected
 * page would race ProtectedRoute and kick the user to /login before the
 * session probe finishes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '../api/client';
import { UnauthorizedError } from '../api/errors';
import type { LoginRequest, User } from '../types';

type AuthState =
  | { status: 'unknown' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User };

interface AuthContextValue {
  state: AuthState;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'unknown' });

  useEffect(() => {
    const controller = new AbortController();
    api.auth
      .me(controller.signal)
      .then((res) => {
        setState({ status: 'authenticated', user: res.user });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (err instanceof UnauthorizedError) {
          setState({ status: 'anonymous' });
          return;
        }
        // Network / 5xx — treat as anonymous so the login page at least
        // becomes reachable. The LoginPage's submit will surface the real
        // problem if the API is genuinely down.
        setState({ status: 'anonymous' });
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (credentials: LoginRequest): Promise<void> => {
    const res = await api.auth.login(credentials);
    setState({ status: 'authenticated', user: res.user });
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.auth.logout();
    } finally {
      // Flip local state even if the network call fails — the user wanted
      // out, and the cookie will expire on its own (or at worst live as
      // an orphan until the 7-day JWT expiry).
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
