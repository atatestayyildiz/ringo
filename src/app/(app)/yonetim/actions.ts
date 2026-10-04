"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/session";

export type AbsentResult = { ok: true; moved: number } | { ok: false; error: string };

export async function markAbsentAction(memberId: string, day: string): Promise<AbsentResult> {
  const ctx = await getSessionContext();
  if (ctx.member.role !== "manager") {
    return { ok: false, error: "Bu işlemi yalnız yönetici yapabilir." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, error: "Geçersiz tarih. Sayfayı yenileyip tekrar deneyin." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_absent", { p_member: memberId, p_day: day });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/yonetim");
  revalidatePath("/bugun");
  return { ok: true, moved: data ?? 0 };
}
