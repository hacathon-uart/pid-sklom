import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { authEnabled } from "./supabase";

const PREFIX = "pidsklom.auth.";
export const PENDING = "pending";
export const RESUME = "resume";
export type PendingAction =
  | { kind: "save"; route: string; id: string }
  | { kind: "generation"; route: string; id: string; path: string; body: Record<string, unknown> };

export function route() {
  return window.location.pathname + window.location.search;
}

export function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    if (!authEnabled) return null;
    throw new Error("Не вдалося прочитати чернетку. Перевірте доступ браузера до сховища");
  }
}

export function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    throw new Error("Браузер не може зберегти чернетку. Дозвольте сховище перед входом");
  }
}

export function remove(key: string) {
  sessionStorage.removeItem(PREFIX + key);
}

export function safeRoute(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) throw new Error("Некоректна адреса повернення");
  const parsed = new URL(value, window.location.origin);
  if (parsed.origin !== window.location.origin || parsed.pathname === "/auth/callback") {
    throw new Error("Некоректна адреса повернення");
  }
  return parsed.pathname + parsed.search;
}

export function pending(key = PENDING): PendingAction | null {
  const action = read<PendingAction>(key);
  if (!action) return null;
  safeRoute(action.route);
  if (!["save", "generation"].includes(action.kind) ||
      typeof action.id !== "string" || !/^[0-9a-f-]{36}$/i.test(action.id)) {
    throw new Error("Некоректна збережена дія входу");
  }
  if (action.kind === "generation" && (
    !/^\/api\/(matches|artworks\/[0-9]+\/captions)$/.test(action.path) ||
    !action.body || typeof action.body !== "object"
  )) throw new Error("Некоректна збережена генерація");
  return action;
}

export function forgetSaved(id: string) {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(PREFIX + "saved:") && JSON.parse(sessionStorage.getItem(key) ?? "null") === id) {
      sessionStorage.removeItem(key);
    }
  }
}

const snapshots = new Map<string, unknown>();

export function flushDrafts() {
  for (const [key, value] of snapshots) write(key, value);
}

export function clearAccountState() {
  remove(PENDING);
  remove(RESUME);
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(PREFIX + "save:") || key.startsWith(PREFIX + "saved:") || key.startsWith(PREFIX + "generation:")) {
      sessionStorage.removeItem(key);
    }
  }
}

export function useTabState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fullKey = `draft:${route()}:${key}`;
  const [state, setState] = useState(() => ({ key: fullKey, value: read<T>(fullKey) ?? initial }));
  const value = state.key === fullKey ? state.value : read<T>(fullKey) ?? initial;
  if (state.key !== fullKey) setState({ key: fullKey, value });
  snapshots.set(fullKey, value);
  useEffect(() => () => { snapshots.delete(fullKey); }, [fullKey]);
  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setState((previous) => ({
      key: fullKey,
      value: typeof next === "function" ? (next as (value: T) => T)(previous.value) : next,
    }));
  }, [fullKey]);
  return [value, setValue];
}
