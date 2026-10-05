"use server";

import { parseLockStatus } from "@/components/lock/activity";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null; to?: "/bugun" | "/pin-belirle" | "/kilit" };

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "E-posta ve şifreyi gir." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "E-posta veya şifre hatalı." };

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!member) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Hesabınız etkin değil. Yöneticinize başvurun." };
  }

  // Şifreli giriş kilidi kaldırmaz: kilit yalnız doğru PIN ya da yöneticinin PIN sıfırlamasıyla kalkar.
  // Hedef proxy'yi beklemeden burada belirlenir: PIN/kilit yönlendirmesi burada da yapılır.
  const { data: st } = await supabase.rpc("lock_status");
  const lock = parseLockStatus(st);
  // Başarı: istemci hedefe gider (panel ise kapı açılışıyla).
  if (lock && !lock.has_pin) return { error: null, to: "/pin-belirle" };
  if (lock?.locked) return { error: null, to: "/kilit" };
  return { error: null, to: "/bugun" };
}
