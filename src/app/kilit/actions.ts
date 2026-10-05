"use server";

import { redirect } from "next/navigation";
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type UnlockResult =
  | { ok: true }
  | { ok: false; error: string; remaining: number; signedOut: boolean };

export type LockResult = { ok: true } | { ok: false; error: string };

/**
 * PIN ile kilidi açar. 5. yanlışta (signedOut) yerel oturum sunucuda kapatılır;
 * istemci /giris?hata=pin'e geçer.
 */
export async function unlockAction(pin: string): Promise<UnlockResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unlock_with_pin", { p_pin: String(pin ?? "") });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: toUserMessage(error), remaining: 0, signedOut: false };
  }
  const r = data as { ok?: unknown; remaining?: unknown; signed_out?: unknown };
  if (r.ok === true) return { ok: true };
  const remaining = typeof r.remaining === "number" ? r.remaining : 0;
  if (r.signed_out === true) {
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, error: "Çok fazla yanlış deneme. E-posta ve şifrenle yeniden giriş yap.", remaining: 0, signedOut: true };
  }
  return { ok: false, error: `PIN yanlış. ${remaining} hakkın kaldı.`, remaining, signedOut: false };
}

/** Paneli sunucuda kilitler (lock_me). Ekran geçişi istemcide (useLock.lockNow). */
export async function lockAction(): Promise<LockResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("lock_me");
  if (error) return { ok: false, error: toUserMessage(error) };
  return { ok: true };
}

/** "PIN'imi unuttum": yerel oturumu kapatır, e-posta + şifre girişine gönderir (kilit girişte kalkar). */
export async function forgotPinAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/giris");
}
