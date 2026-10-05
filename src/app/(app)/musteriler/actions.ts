"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/session";
import { can } from "@/lib/access";

export type BulkReassignResult = { ok: true; moved: number } | { ok: false; error: string };

export async function reassignCustomersAction(customerIds: string[], memberId: string): Promise<BulkReassignResult> {
  const ctx = await getSessionContext();
  if (!can(ctx.member, "reassign")) {
    return { ok: false, error: "Müşteri devretme yetkiniz yok." };
  }
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return { ok: false, error: "Devredilecek müşteri seçilmedi." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reassign_customers", { p_customers: customerIds, p_member: memberId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/musteriler");
  revalidatePath("/bugun");
  return { ok: true, moved: data ?? 0 };
}
