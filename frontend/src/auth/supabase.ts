import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled =
  import.meta.env.VITE_AUTH_MODE !== "disabled" && (Boolean(url && anonKey) || import.meta.env.DEV);

/** Fake login is development-only; public builds without Auth configuration have no accounts. */
export const supabase = authEnabled && url && anonKey ? createClient(url, anonKey) : null;
