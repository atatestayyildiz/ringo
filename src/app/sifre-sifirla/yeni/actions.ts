"use server";

import { redirect } from "next/navigation";
import { completePasswordReset } from "@/lib/password-reset";
import { statelessClient } from "@/lib/supabase/stateless";

export type NewPasswordState = { error: string | null; linkDead: boolean };

/** Kod burada, form gönderilince doğrulanır (sayfayı açmak kodu tüketmez; e-posta tarayıcıları kodu yakamaz). */
export async function newPasswordAction(_prev: NewPasswordState, formData: FormData): Promise<NewPasswordState> {
  const supabase = statelessClient();
  const res = await completePasswordReset(
    formData.get("token_hash"),
    formData.get("type"),
    formData.get("password"),
    formData.get("repeat"),
    {
      verify: (tokenHash) => supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }),
      update: (password) => supabase.auth.updateUser({ password }),
      signOutAll: () => supabase.auth.signOut({ scope: "global" }),
    },
  );
  if (!res.ok) return { error: res.error, linkDead: Boolean(res.linkDead) };
  redirect("/giris?sifre=yenilendi");
}
