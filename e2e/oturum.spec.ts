import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { PASSWORD, USERS, freshPage, loginOk } from "./helpers";

// Oturum sunucuda kapatılınca (başka cihazdan tüm cihazlardan çıkış) /giris <-> /bugun döngüsü olmamalı.
// Supabase adresi/anon anahtarı env'den, yoksa yerel `supabase status`tan okunur.
function localSupabase(): { url: string; anon: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon) return { url, anon };
  const s = JSON.parse(execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
  return { url: s.API_URL, anon: s.ANON_KEY };
}

test("sunucuda kapatılan oturum döngüye girmez", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await loginOk(page, "ayse");
  const { url, anon } = localSupabase();
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: USERS.ayse, password: PASSWORD });
  expect(error).toBeNull();
  await sb.auth.signOut(); // global: tarayıcıdaki oturum da sunucuda kapanır
  for (const path of ["/giris", "/", "/bugun"]) {
    const resp = await page.goto(path);
    expect(resp?.status(), path).toBeLessThan(400);
    await expect(page).toHaveURL(/\/giris/);
  }
  await loginOk(page, "ayse");
  await expect(page).toHaveURL(/\/bugun/);
  await context.close();
});
