import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Bu test kendi geçici kullanıcısını oluşturur ve siler; seed kullanıcılarının şifresine dokunmaz.
const OLD_PASSWORD = "EskiSifre123!";
const NEW_PASSWORD = "YeniSifre456!";

function supabaseKeys() {
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return {
    url: j.API_URL as string,
    service: (j.SERVICE_ROLE_KEY ?? j.SECRET_KEY) as string,
    mail: (j.MAILPIT_URL ?? j.INBUCKET_URL ?? "http://127.0.0.1:54324") as string,
  };
}

const keys = supabaseKeys();
let admin: SupabaseClient;
let userId = "";
const email = `sifirla-${Date.now().toString(36)}@demo.test`;

async function mailsFor(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${keys.mail}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  const body = (await res.json()) as { messages?: { ID: string }[] };
  return body.messages ?? [];
}

async function resetLink(address: string): Promise<string> {
  let id = "";
  await expect
    .poll(async () => {
      id = (await mailsFor(address))[0]?.ID ?? "";
      return id;
    }, { timeout: 20_000 })
    .not.toBe("");
  const msg = (await (await fetch(`${keys.mail}/api/v1/message/${id}`)).json()) as { HTML: string; Subject: string };
  expect(msg.Subject).toBe("Şifreni sıfırla");
  const m = msg.HTML.match(/href="([^"]*\/sifre-sifirla\/yeni[^"]*)"/);
  expect(m).not.toBeNull();
  return m![1].replace(/&amp;/g, "&");
}

test.beforeAll(async () => {
  admin = createClient(keys.url, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tenant } = await admin.from("tenants").select("id").limit(1).single();
  const created = await admin.auth.admin.createUser({ email, password: OLD_PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("test kullanıcısı oluşturulamadı");
  userId = created.data.user.id;
  const { error } = await admin.from("members").insert({
    tenant_id: tenant!.id,
    user_id: userId,
    full_name: "Sıfırlama Deneme",
    role: "agent",
    permissions: {},
    is_active: true,
  });
  if (error) throw new Error("test üyesi oluşturulamadı");
});

test.afterAll(async () => {
  if (userId) {
    await admin.from("members").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
});

test("giriş sayfasında şifremi unuttum bağlantısı var", async ({ page }) => {
  await page.goto("/giris");
  await page.getByRole("link", { name: "Şifremi unuttum" }).click();
  await expect(page).toHaveURL(/\/sifre-sifirla$/);
});

test("kayıtlı ve kayıtsız e-posta aynı yanıtı alır", async ({ page }) => {
  const same = "Bu e-posta kayıtlıysa bağlantı gönderdik.";
  await page.goto("/sifre-sifirla");
  await page.getByLabel("E-posta").fill(`yok-${Date.now().toString(36)}@demo.test`);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByTestId("reset-sent")).toContainText(same);
  const unknownText = (await page.getByTestId("reset-sent").innerText()).trim();

  await page.goto("/sifre-sifirla");
  await page.getByLabel("E-posta").fill(email);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByTestId("reset-sent")).toContainText(same);
  expect((await page.getByTestId("reset-sent").innerText()).trim()).toBe(unknownText);
});

test("bağlantı iste, e-postadaki bağlantıdan yeni şifre belirle, yeni şifreyle gir", async ({ page, browser }) => {
  await page.goto("/sifre-sifirla");
  await page.getByLabel("E-posta").fill(email);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByTestId("reset-sent")).toBeVisible();

  const link = await resetLink(email);

  // Bağlantı başka bir tarayıcıda (oturumsuz, çerezsiz bağlam) açılır: PKCE çerezine bağlı değil.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  const resp = await p2.goto(link);
  await expect(p2).toHaveURL(/\/sifre-sifirla\/yeni/);
  // D3: kod adres çubuğunda kalmaz (gizli inputta durur); yanıt başlıkları sızıntıyı kapatır
  await expect.poll(() => p2.url()).not.toContain("token_hash");
  expect(p2.url()).toMatch(/\/sifre-sifirla\/yeni$/);
  expect(resp!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(resp!.headers()["cache-control"]).toContain("no-store");
  await expect(p2.locator('input[name="token_hash"]')).toHaveCount(1);

  // Uyuşmayan tekrar reddedilir, kısa şifre reddedilir
  await p2.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
  await p2.getByLabel("Yeni şifre (tekrar)").fill("Baska123456!");
  await p2.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(p2.locator(".form-error")).toContainText("Şifreler aynı değil");
  await p2.getByLabel("Yeni şifre", { exact: true }).fill("kisa");
  await p2.getByLabel("Yeni şifre (tekrar)").fill("kisa");
  await p2.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(p2.locator(".form-error")).toContainText("en az 8 karakter");

  await p2.getByLabel("Yeni şifre", { exact: true }).fill(NEW_PASSWORD);
  await p2.getByLabel("Yeni şifre (tekrar)").fill(NEW_PASSWORD);
  await p2.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(p2).toHaveURL(/\/giris/);
  await expect(p2.getByText("Şifren değişti")).toBeVisible();

  // Eski şifre artık çalışmaz, yenisi çalışır
  await p2.getByLabel("E-posta").fill(email);
  await p2.getByLabel("Şifre").fill(OLD_PASSWORD);
  await p2.getByRole("button", { name: "Giriş yap" }).click();
  await expect(p2.locator(".form-error")).toContainText("E-posta veya şifre hatalı");
  // Form her gönderimden sonra sıfırlanır
  await p2.getByLabel("E-posta").fill(email);
  await p2.getByLabel("Şifre").fill(NEW_PASSWORD);
  await p2.getByRole("button", { name: "Giriş yap" }).click();
  await expect(p2).toHaveURL(/\/bugun/);

  // Aynı bağlantı ikinci kez kullanılamaz
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(link);
  await p3.getByLabel("Yeni şifre", { exact: true }).fill("BaskaSifre789!");
  await p3.getByLabel("Yeni şifre (tekrar)").fill("BaskaSifre789!");
  await p3.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(p3.locator(".form-error")).toContainText("Bağlantı geçersiz");
  await ctx.close();
  await ctx3.close();
});

test("bağlantısız ya da bozuk bağlantıyla yeni şifre sayfası form göstermez", async ({ page }) => {
  await page.goto("/sifre-sifirla/yeni");
  await expect(page.getByLabel("Yeni şifre", { exact: true })).toHaveCount(0);
  await expect(page.locator(".form-error")).toContainText("Bağlantı geçersiz");
});

test("sıfırlama yolları oturumsuz açılır, benzer yollar giriş sayfasına yönlenir", async ({ request }) => {
  for (const p of ["/sifre-sifirla", "/sifre-sifirla/yeni"]) {
    expect((await request.get(p, { maxRedirects: 0 })).status()).toBe(200);
  }
  for (const p of ["/sifre-sifirla-x", "/sifre-sifirla/yeni/x", "/sifre-sifirla/x", "/sifre-sifirlax/yeni"]) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect([307, 308], p).toContain(r.status());
    expect(r.headers()["location"] ?? "").toContain("/giris");
  }
});
