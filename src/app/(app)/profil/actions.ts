"use server";

import { createClient as createBareClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "./password";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function setAccentAction(color: string | null): Promise<Result> {
  await getSessionContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_accent", { p_color: color });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/", "layout");
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
