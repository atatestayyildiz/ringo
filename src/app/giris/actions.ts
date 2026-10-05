"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

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

  redirect("/bugun");
}
