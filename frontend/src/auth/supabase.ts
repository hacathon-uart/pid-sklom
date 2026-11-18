import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled =
  import.meta.env.VITE_AUTH_MODE !== "disabled" &&
  (Boolean(url && anonKey) || (import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE !== "supabase"));

export const authConfigurationError = import.meta.env.VITE_AUTH_MODE === "supabase" && !(url && anonKey)
  ? "Вхід не налаштовано: потрібні публічні Supabase URL та ключ"
  : null;

/** Fake login is development-only; public builds without Auth configuration have no accounts. */
export const supabase = authEnabled && url && anonKey
  ? createClient(url, anonKey, { auth: { flowType: "pkce", detectSessionInUrl: false } })
  : null;
