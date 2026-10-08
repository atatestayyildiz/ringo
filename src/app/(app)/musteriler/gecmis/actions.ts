"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type ClaimArchiveResult = { ok: true; claimed: number; skipped: number } | { ok: false; error: string };

/**
 * Seçilen geçmiş dönem müşterilerini çağırana atar (claim_archive_customers). Uygunluk, 10'luk sınır ve
 * "başkası aldı" kuralları DB'de; burada yalnız çağırır ve hatayı Türkçeye çevirir.
 */
export async function claimArchiveAction(customerIds: string[]): Promise<ClaimArchiveResult> {
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return { ok: false, error: "Müşteri seçilmedi." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_archive_customers", { p_customers: customerIds });
  if (error) return { ok: false, error: toUserMessage(error) };
  const r = (data ?? {}) as { claimed?: unknown; skipped?: unknown };
  revalidatePath("/musteriler/gecmis");
  revalidatePath("/bugun");
  return {
    ok: true,
    claimed: typeof r.claimed === "number" ? r.claimed : 0,
    skipped: typeof r.skipped === "number" ? r.skipped : 0,
  };
}
