import "server-only";
// YALNIZ SUNUCU: service role istemcisi. Yalnız Telegram/cron route'ları kullanır.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Sunucu yapılandırması eksik: SUPABASE_SERVICE_ROLE_KEY tanımlı değil.");
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
