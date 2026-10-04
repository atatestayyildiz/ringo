// YALNIZ SUNUCU: Service role istemcisi. Bu dosya istemci bileşenlerinden asla import edilmez.
// (`server-only` paketi projede yok; yalnız ayarlar/actions.ts ve ayarlar/page.tsx import eder.)
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Sunucu yapılandırması eksik: SUPABASE_SERVICE_ROLE_KEY tanımlı değil.");
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** user_id -> e-posta (members tablosunda e-posta yok). */
export async function listAuthEmails(): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const out = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) if (u.email) out.set(u.id, u.email);
    if (data.users.length < 200) break;
  }
  return out;
}
