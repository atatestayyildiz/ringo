"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "./password";

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

export async function changePasswordAction(current: string, password: string, repeat: string): Promise<Result> {
  const ctx = await getSessionContext();
  const supabase = await createClient();
  return changePassword(current, password, repeat, {
    email: ctx.user.email,
    verify: async (email, pw) => {
      // Oturum çerezlerine dokunmayan geçici istemci; doğrulama oturumu hemen kapatılır.
      const { url, anonKey } = supabaseEnv();
      const tmp = createBareClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await tmp.auth.signInWithPassword({ email, password: pw });
      if (!error) await tmp.auth.signOut({ scope: "local" }).catch(() => undefined);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    update: async (pw) => {
      const { error } = await supabase.auth.updateUser({ password: pw });
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    signOutOthers: async () => {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      return { error: error ? { code: error.code, message: error.message } : null };
    },
  });
}
