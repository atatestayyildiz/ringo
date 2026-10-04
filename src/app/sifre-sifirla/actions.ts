"use server";

import { requestPasswordReset } from "@/lib/password-reset";
import { statelessClient } from "@/lib/supabase/stateless";

export type ResetRequestState = { error: string | null; message: string | null };

/**
 * Hesap var/yok ayrımı yapılmaz: biçim geçerliyse yanıt her zaman aynıdır.
 * Hız sınırı Supabase Auth'a dayanır (kullanıcı başına bekleme süresi + saatlik e-posta kotası); bkz. docs/sifre-sifirlama.md.
 */
export async function requestResetAction(_prev: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const supabase = statelessClient();
  const res = await requestPasswordReset(formData.get("email"), (email) => supabase.auth.resetPasswordForEmail(email));
  return res.ok ? { error: null, message: res.message } : { error: res.error, message: null };
}
