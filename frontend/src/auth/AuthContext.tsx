import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { setAuthToken } from "../api/client";
import { authConfigurationError, authEnabled, supabase } from "./supabase";
import { SaveLoginDialog } from "./SaveLoginDialog";
import { clearAccountState, flushDrafts, pending, PENDING, read, RESUME, remove, route, safeRoute, write, type PendingAction } from "./workflow";

export interface AuthUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  requireLogin: (action: () => void, continuation?: PendingAction) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const FAKE_KEY = "pidsklom.fakeUser";
let callbackExchange: { code: string; promise: ReturnType<NonNullable<typeof supabase>["auth"]["exchangeCodeForSession"]> } | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(authConfigurationError);
  const [offered, setOffered] = useState<PendingAction | null>(null);

  useEffect(() => {
    const needed = (event: Event) => setOffered((event as CustomEvent<PendingAction>).detail);
    const draftError = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener("pidsklom:login-needed", needed);
    window.addEventListener("pidsklom:draft-error", draftError);
    return () => {
      window.removeEventListener("pidsklom:login-needed", needed);
      window.removeEventListener("pidsklom:draft-error", draftError);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!supabase) {
      if (authEnabled && localStorage.getItem(FAKE_KEY)) {
        setAuthToken("dev");
        setUser({ id: "dev", name: "Dev" });
      } else setAuthToken(null);
      setReady(true);
      return;
    }
    const client = supabase;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        try { flushDrafts(); clearAccountState(); }
        catch (failure) { setError((failure as Error).message); }
      }
      setAuthToken(session?.access_token ?? null);
      setUser(session ? {
        id: session.user.id,
        name: session.user.user_metadata?.full_name ?? session.user.email ?? "Користувач",
        avatarUrl: session.user.user_metadata?.avatar_url,
      } : null);
    });
    const restore = async () => {
      try {
        if (window.location.pathname === "/auth/callback") {
          const query = new URLSearchParams(window.location.search);
          if (query.get("error")) throw new Error("Вхід скасовано або Google відхилив запит");
          const code = query.get("code");
          if (!code) throw new Error("Відповідь входу не містить коду");
          if (!callbackExchange || callbackExchange.code !== code) {
            callbackExchange = { code, promise: client.auth.exchangeCodeForSession(code) };
          }
          const result = await callbackExchange.promise;
          if (!active) return;
          if (result.error) throw result.error;
          const action = pending();
          if (action) write(RESUME, action);
          remove(PENDING);
          const destination = action?.route ?? read<string>("return") ?? "/";
          window.location.replace(safeRoute(destination));
          return;
        }
        const result = await client.auth.getSession();
        if (result.error) throw result.error;
        if (active) {
          const session = result.data.session;
          setAuthToken(session?.access_token ?? null);
          setUser(session ? {
            id: session.user.id,
            name: session.user.user_metadata?.full_name ?? session.user.email ?? "Користувач",
            avatarUrl: session.user.user_metadata?.avatar_url,
          } : null);
          setReady(true);
        }
      } catch (failure) {
        if (!active) return;
        setError(failure instanceof Error ? failure.message : "Не вдалося відновити сесію");
        remove(PENDING);
        remove(RESUME);
        setReady(true);
      }
    };
    void restore();
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const startLogin = useCallback(async (action?: PendingAction) => {
    setError(null);
    try {
      if (!authEnabled) throw new Error("Вхід поки недоступний");
      flushDrafts();
      write("return", route());
      if (action) write(PENDING, action);
      else remove(PENDING);
      remove(RESUME);
      if (supabase) {
        const result = await supabase.auth.signInWithOAuth({
          provider: "google", options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            queryParams: { prompt: "select_account" },
          },
        });
        if (result.error) throw result.error;
      } else {
        localStorage.setItem(FAKE_KEY, "1");
        setAuthToken("dev");
        setUser({ id: "dev", name: "Dev" });
        if (action) write(RESUME, action);
        remove(PENDING);
      }
      setOffered(null);
    } catch (failure) {
      remove(PENDING);
      setError(failure instanceof Error ? failure.message : "Не вдалося увійти");
    }
  }, []);

  const login = useCallback(() => startLogin(), [startLogin]);
  const logout = useCallback(async () => {
    try {
      if (supabase) {
        const result = await supabase.auth.signOut();
        if (result.error) throw result.error;
      }
      localStorage.removeItem(FAKE_KEY);
      clearAccountState();
      setOffered(null);
      setAuthToken(null);
      setUser(null);
      // Discard mounted account data and editor ownership after a session change.
      window.location.assign("/");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не вдалося вийти");
    }
  }, []);

  const requireLogin = useCallback((action: () => void, continuation?: PendingAction) => {
    if (!ready) return;
    if (user) action();
    else if (continuation?.kind === "save") {
      setError(null);
      setOffered(continuation);
    }
    else if (continuation) void startLogin(continuation);
    else void login();
  }, [ready, user, startLogin, login]);

  const saveOffer = offered?.kind === "save" ? offered : null;

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, requireLogin }}>
      {saveOffer && <SaveLoginDialog
        error={error}
        onContinue={() => startLogin(saveOffer)}
        onCancel={() => { setOffered(null); setError(null); }}
      />}
      {!saveOffer && (error || offered) && <div role="alert" className="relative z-50 ml-[var(--app-side-offset)] border-b border-line bg-surface p-5">
        <p>{error ?? (offered?.kind === "export"
          ? "Три унікальні PNG використано. Увійдіть через Google, щоб завантажувати нові. Повтори незмінених мемів залишаються безкоштовними."
          : "Три гостьові генерації використано. Увійдіть через Google, щоб продовжити.")}</p>
        {offered && <button className="t-strong mr-5 text-accent" onClick={() => void startLogin(offered)}>Увійти через Google і продовжити</button>}
        <button className="t-strong mr-5" onClick={() => { setOffered(null); setError(null); }}>Закрити</button>
        {window.location.pathname === "/auth/callback" && <button className="t-strong" onClick={() => {
          const destination = read<string>("return");
          window.location.assign(safeRoute(destination ?? "/"));
        }}>Повернутися до чернетки</button>}
      </div>}
      {ready ? <div key={user?.id ?? "guest"}>{children}</div> : <p role="status" className="p-12">Відновлюємо сесію…</p>}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
