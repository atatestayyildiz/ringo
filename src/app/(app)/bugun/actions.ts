"use server";

import { revalidatePath } from "next/cache";
import { OUTCOME_VALUES, type DistributeResult, type LogCallResult, type Outcome } from "@/components/bugun/model";
import type { CallStatus } from "@/components/ui";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function logCallAction(
  customerId: string,
  outcome: string,
  note: string | null,
  callbackAt: string | null,
  appointmentDay: string | null = null,
  appointmentTime: string | null = null,
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
  let apDay: string | undefined;
  let apTime: string | undefined;
  if (outcome === "appointment") {
    if (appointmentDay && !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDay)) {
      return { ok: false, error: "Randevu günü geçersiz." };
    }
    if (appointmentTime && !/^\d{2}:\d{2}$/.test(appointmentTime)) {
      return { ok: false, error: "Randevu saati geçersiz." };
    }
    apDay = appointmentDay ?? undefined;
    apTime = appointmentDay ? (appointmentTime ?? undefined) : undefined;
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
    p_appointment_day: apDay,
    p_appointment_time: apTime,
  });
  if (error || !data) {
    return { ok: false, error: toUserMessage(error) };
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
    return { ok: false, error: toUserMessage(error) };
  }
  revalidatePath("/bugun");
  return { ok: true, count: data ?? 0 };
}
