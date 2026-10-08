"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

const PIN_RE = /^\d{4,8}$/;

/** İlk PIN belirleme (/pin-belirle). Zayıf PIN kuralı DB'de (set_my_pin, 22023 Türkçe mesaj). */
export async function setPinAction(pin: string, again: string): Promise<Result> {
  if (!PIN_RE.test(pin)) return { ok: false, error: "PIN 4 ile 8 hane arasında bir sayı olmalı." };
  if (pin !== again) return { ok: false, error: "PIN'ler aynı değil. Baştan gir." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_pin", { p_new: pin });
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true };
}

/** Profil > Güvenlik: mevcut PIN ile değiştirme. */
export async function changePinAction(current: string, pin: string, again: string): Promise<Result> {
  if (!PIN_RE.test(current)) return { ok: false, error: "Mevcut PIN'i gir (4 ile 8 hane)." };
  if (!PIN_RE.test(pin)) return { ok: false, error: "Yeni PIN 4 ile 8 hane arasında bir sayı olmalı." };
  if (pin !== again) return { ok: false, error: "Yeni PIN'ler aynı değil." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_pin", { p_new: pin, p_current_pin: current });
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true };
}

/** Profil > Güvenlik: otomatik kilit süresi (0 = kapalı). İzin verilen değerler DB'de. */
export async function setAutoLockAction(minutes: number, mobile = false): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(mobile ? "set_my_auto_lock_mobile" : "set_my_auto_lock", { p_minutes: minutes });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profil");
  return { ok: true };
}
