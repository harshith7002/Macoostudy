import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || "https://yxyxkkzzgvgshndpwizr.supabase.co";
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || "";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey || "dummy-anon-key-prevent-crash"
);

/**
 * Check if Supabase env credentials are fully configured.
 */
export function isSupabaseConfigured() {
  const url = process.env.REACT_APP_SUPABASE_URL || "";
  const key = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  return Boolean(
    url &&
    key &&
    !url.includes("placeholder") &&
    key !== "placeholder-anon-key"
  );
}
