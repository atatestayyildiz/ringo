import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/** Oturumsuz, çerezsiz anon istemci (şifre sıfırlama gibi tarayıcı oturumuna dokunmaması gereken akışlar). */
export function statelessClient() {
  const { url, anonKey } = supabaseEnv();
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
