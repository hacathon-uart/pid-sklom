import { useCallback, useEffect, useState } from "react";

/** Tiny data-fetching hook: `const { data, error, loading, reload } = useApi(() => api.artists(), [])`. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(fn, deps);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    run()
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}
