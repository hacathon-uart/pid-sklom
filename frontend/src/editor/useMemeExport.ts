import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, type ExportAuthorization } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { authEnabled } from "../auth/supabase";
import { pending, RESUME, remove, route, type PendingAction } from "../auth/workflow";
import { downloadDataUrl } from "./exportPng";

export function useMemeExport(scope: string, artworkId: number, prepare: () => Promise<string>, ready: () => boolean) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const active = useRef(true);
  const current = useRef({ scope, artworkId, prepare, ready });
  useLayoutEffect(() => { current.current = { scope, artworkId, prepare, ready }; });

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const source = current.current;
    let authorization: ExportAuthorization | null = null;
    try {
      if (!source.ready()) throw new Error("PNG ще не готовий. Дочекайтеся зображення й спробуйте ще раз");
      const png = await source.prepare();
      if (!active.current || source.scope !== current.current.scope) throw new Error("Картину змінено. Повторіть експорт обраного мему");
      if (authEnabled && !user) {
        try {
          authorization = await api.authorizeExport(source.artworkId, png);
        } catch (failure) {
          if (failure instanceof ApiError && failure.code === "guest_export_limit_exceeded") {
            const action: PendingAction = {
              kind: "export", scope: source.scope, mode: "download", route: route(), id: crypto.randomUUID(),
            };
            window.dispatchEvent(new CustomEvent("pidsklom:login-needed", { detail: action }));
            return;
          }
          throw failure;
        }
      }
      if (!active.current || source.scope !== current.current.scope) {
        if (authorization?.enabled && authorization.lease) {
          await api.finishExport(authorization.fingerprint, authorization.lease, false);
        }
        throw new Error("Картину змінено. Повторіть експорт обраного мему");
      }
      try {
        downloadDataUrl(png);
      } catch (failure) {
        if (authorization?.enabled && authorization.lease) {
          await api.finishExport(authorization.fingerprint, authorization.lease, false);
        }
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        throw failure;
      }
      if (authorization?.enabled && authorization.lease) {
        await api.finishExport(authorization.fingerprint, authorization.lease, true);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не вдалося експортувати PNG");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [user]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [scope]);

  useEffect(() => {
    const action = pending(RESUME);
    if (!user || action?.kind !== "export" || action.route !== route()) return;
    const deadline = Date.now() + 30000;
    const timer = window.setInterval(() => {
      if (Date.now() > deadline) {
        remove(RESUME);
        setError("Не вдалося підготувати PNG після входу. Чернетку збережено; повторіть експорт");
        window.clearInterval(timer);
      } else if (action.scope === current.current.scope && current.current.ready()) {
        remove(RESUME);
        window.clearInterval(timer);
        if (action.mode === "download") void run();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [user, scope, run]);

  return { run, busy, error };
}
