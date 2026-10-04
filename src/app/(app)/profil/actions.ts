"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const CODE_TTL_MS = 15 * 60 * 1000;

export async function createLinkCodeAction(): Promise<Result<{ code: string; expiresAt: string }>> {
  await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("telegram_create_link_code");
  if (error || !data) return { ok: false, error: toUserMessage(error) };
  return { ok: true, code: data, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() };
}

export async function telegramStatusAction(): Promise<Result<{ linked: boolean; linkedAt: string | null }>> {
  const ctx = await getSessionContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("telegram_chat_id, telegram_linked_at")
    .eq("id", ctx.member.id)
    .maybeSingle();
  if (error || !data) return { ok: false, error: toUserMessage(error) };
  return { ok: true, linked: data.telegram_chat_id !== null, linkedAt: data.telegram_linked_at };
}

export async function unlinkSelfAction(): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("telegram_unlink", {});
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profil");
  return { ok: true };
}

export async function saveNotifyPrefsAction(prefs: {
  morning: boolean;
  reminder: boolean;
  summary: boolean;
}): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notify_prefs", {
    p_morning: prefs.morning,
    p_reminder: prefs.reminder,
    p_summary: prefs.summary,
  });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/profil");
  return { ok: true };
}

const MIN_PASSWORD = 8;

export async function changePasswordAction(password: string, repeat: string): Promise<Result> {
  await getSessionContext();
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { ok: false, error: `Şifre en az ${MIN_PASSWORD} karakter olmalı.` };
  }
  if (password !== repeat) return { ok: false, error: "Şifreler aynı değil." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { ok: false, error: "Yeni şifre eskisiyle aynı olamaz." };
    if (error.code === "weak_password") return { ok: false, error: "Şifre çok zayıf. Daha uzun veya karmaşık bir şifre seçin." };
    return { ok: false, error: toUserMessage({ code: error.code, message: error.message }) };
  }
  return { ok: true };
}
