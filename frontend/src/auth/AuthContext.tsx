/**
 * Login state (US-06, US-07). Owner: B + A — T22.
 *
 * Without VITE_SUPABASE_URL this is a FAKE login: «Увійти» instantly logs you in as «dev»,
 * and the backend (AUTH_MODE=stub) accepts the token "dev" as user id. Swap in Supabase:
 *   - login(): supabase.auth.signInWithOAuth({ provider: "google" }) or signInWithOtp({ email })
 *   - subscribe to supabase.auth.onAuthStateChange and call setAuthToken(session.access_token)
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken } from "../api/client";
import { supabase } from "./supabase";

export interface AuthUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  /** Opens the login flow. Resolves once logged in (fake mode) or after redirect (Supabase). */
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Run `action` if logged in, otherwise log in first. Use for «Зберегти». */
  requireLogin: (action: () => void) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const FAKE_KEY = "pidsklom.fakeUser";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (supabase) return null;
    let restored: AuthUser | null = null;
    try {
      restored = localStorage.getItem(FAKE_KEY) ? { id: "dev", name: "Dev" } : null;
    } catch {
      /* storage blocked */
    }
    // Set synchronously: children's effects (first API calls) run before this provider's effects.
    setAuthToken(restored?.id ?? null);
    return restored;
  });

  useEffect(() => {
    if (!supabase) return;
    // TODO(B, T22): real Supabase session handling. Pages that need login should wait until the
    // initial session is restored (supabase.auth.getSession()) before calling the API.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthToken(session?.access_token ?? null);
      setUser(
        session
          ? {
              id: session.user.id,
              name: session.user.user_metadata?.full_name ?? session.user.email ?? "Користувач",
              avatarUrl: session.user.user_metadata?.avatar_url,
            }
          : null,
      );
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const login = useCallback(async () => {
    if (supabase) {
      // TODO(B, T22): show a login dialog with Google + email magic link (not designed yet)
      await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
      return;
    }
    try {
      localStorage.setItem(FAKE_KEY, "1");
    } catch {
      /* private mode: fake login lasts until reload */
    }
    setAuthToken("dev");
    setUser({ id: "dev", name: "Dev" });
  }, []);

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(FAKE_KEY);
    } catch {
      /* ignore */
    }
    setAuthToken(null);
    setUser(null);
  }, []);

  const requireLogin = useCallback(
    (action: () => void) => {
      if (user) action();
      else login().then(() => !supabase && action());
    },
    [user, login],
  );

  return <AuthContext.Provider value={{ user, login, logout, requireLogin }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
