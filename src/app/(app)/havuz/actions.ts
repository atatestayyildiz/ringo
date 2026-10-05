"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TakeResult = { ok: true; name: string } | { ok: false; error: string };

/** Havuzdaki müşteriyi çağıranın bugünkü listesine alır. Kural take_from_pool'da. */
export async function takeFromPoolAction(customerId: string): Promise<TakeResult> {
  if (!UUID.test(customerId)) {
    return { ok: false, error: "Geçersiz istek. Sayfayı yenileyip tekrar deneyin." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("take_from_pool", { p_customer: customerId });
  if (error || !data) {
    return { ok: false, error: toUserMessage(error) };
  }
  revalidatePath("/havuz");
  revalidatePath("/bugun");
  return { ok: true, name: data.full_name };
}
