import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** null when Supabase env vars are not set → AuthContext uses the fake dev login. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
