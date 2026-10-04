"use server";

import { revalidatePath } from "next/cache";
import { OUTCOME_VALUES, type DistributeResult, type LogCallResult, type Outcome } from "@/components/bugun/model";
import type { CallStatus } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Veritabanının Türkçe iş kuralı hataları bu kodlarla gelir; diğerleri genel mesaja döner. */
const RULE_ERRORS = new Set(["22023", "42501", "P0002"]);
const GENERIC = "Kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.";

export async function logCallAction(
  customerId: string,
  outcome: string,
  note: string | null,
  callbackAt: string | null,
): Promise<LogCallResult> {
  if (!UUID.test(customerId) || !OUTCOME_VALUES.includes(outcome as Outcome)) {
    return { ok: false, error: "Geçersiz istek. Sayfayı yenileyip tekrar deneyin." };
  }
  const cleanNote = (note ?? "").trim().slice(0, 1000);
  let cb: string | undefined;
  if (outcome === "callback") {
    const d = callbackAt ? new Date(callbackAt) : null;
    if (!d || Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      return { ok: false, error: "Geri arama zamanı gelecekte bir tarih ve saat olmalı." };
    }
    cb = d.toISOString();
  }
  if (outcome === "disqualified" && !cleanNote) {
    return { ok: false, error: "Uygun değil için nedeni not olarak yazın." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("log_call", {
    p_customer: customerId,
    p_outcome: outcome,
    p_note: cleanNote || undefined,
    p_callback_at: cb,
  });
  if (error || !data) {
    return { ok: false, error: error && RULE_ERRORS.has(error.code) ? error.message : GENERIC };
  }
  revalidatePath("/bugun");
  return {
    ok: true,
    status: data.call_status as CallStatus,
    attempts: data.attempts_in_round,
    poolCount: data.pool_count,
    nextCallAt: data.next_call_at,
  };
}

export async function distributeDayAction(): Promise<DistributeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("distribute_day");
  if (error) {
    return {
      ok: false,
      error: RULE_ERRORS.has(error.code) ? error.message : "Dağıtım yapılamadı. Biraz sonra tekrar deneyin.",
    };
  }
  revalidatePath("/bugun");
  return { ok: true, count: data ?? 0 };
}
