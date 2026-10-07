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

export type DeleteAllResult = { ok: true; deleted: number } | { ok: false; error: string };

/** Yalnız yönetici. `expected` ekranda gösterilen toplam sayıdır; DB gerçek sayıyla karşılaştırır. */
export async function deleteAllCustomersAction(expected: number): Promise<DeleteAllResult> {
  const ctx = await getSessionContext();
  if (ctx.member.role !== "manager") {
    return { ok: false, error: "Tüm müşterileri yalnız yönetici silebilir." };
  }
  if (!Number.isInteger(expected) || expected < 1) {
    return { ok: false, error: "Silinecek müşteri yok." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_all_customers", { p_expected: expected });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/musteriler");
  revalidatePath("/bugun");
  return { ok: true, deleted: data ?? 0 };
}

export type BulkDeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

export async function deleteCustomersAction(customerIds: string[]): Promise<BulkDeleteResult> {
  const ctx = await getSessionContext();
  if (!can(ctx.member, "delete_customers")) {
    return { ok: false, error: "Müşteri silme yetkiniz yok." };
  }
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return { ok: false, error: "Silinecek müşteri seçilmedi." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_customers", { p_customers: customerIds });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/musteriler");
  revalidatePath("/bugun");
  return { ok: true, deleted: data ?? 0 };
}
