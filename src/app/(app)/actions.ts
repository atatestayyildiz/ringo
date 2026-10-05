"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createClient();
  // Yalnız bu cihaz: diğer cihazlardaki oturumlar açık kalır (hepsinden çıkış şifre değişiminde).
  await supabase.auth.signOut({ scope: "local" });
  redirect("/giris");
}
