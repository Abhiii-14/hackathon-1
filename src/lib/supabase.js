import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xrvnwzpttejnivxqigmz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_BT69n1h0rfetfqAJ0Zii-w_taJnYfuc";

const hasSupabaseCredentials =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_ANON_KEY.startsWith("sb_publishable_");

export const supabase = hasSupabaseCredentials
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  })
  : null;

export const isSupabaseConfigured = Boolean(supabase);
