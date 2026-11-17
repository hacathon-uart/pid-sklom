import { useEffect, useState } from "react";
import { getGuest } from "../api/client";
import { useAuth } from "./AuthContext";
import { authEnabled } from "./supabase";

export function GuestAllowance() {
  const { user, ready, login } = useAuth();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!authEnabled || !ready || user) return;
    let active = true;
    void getGuest().then((guest) => {
      if (active) setRemaining(guest.remaining);
    }).catch((failure: Error) => { if (active) setError(failure.message); });
    const update = (event: Event) => setRemaining((event as CustomEvent<number>).detail);
    window.addEventListener("pidsklom:allowance", update);
    return () => { active = false; window.removeEventListener("pidsklom:allowance", update); };
  }, [ready, user]);
  if (user || (!error && remaining === null)) return null;
  return (
    <aside className="border-b border-line px-8 py-3" aria-live="polite">
      {error ?? `Гостьові ШІ-генерації: ${remaining} із 3 залишилось.`}{" "}
      <button className="t-strong text-accent" onClick={login}>Увійти через Google</button>
      <span className="t-small ml-3">Редагування вручну та PNG — без обмежень.</span>
    </aside>
  );
}
