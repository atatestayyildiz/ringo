import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { login, loginOk, PASSWORD, TEST_PIN, typePin, userMenuItem, USERS } from "./helpers";

// Panel kilidi (spec 2026-10-05 §1). İlk giriş testi kendi geçici kullanıcısını açar ve siler;
// demo kullanıcıların kilit durumu her testten sonra temizlenir.

function supabaseKeys() {
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return { url: j.API_URL as string, service: (j.SERVICE_ROLE_KEY ?? j.SECRET_KEY) as string };
}

const keys = supabaseKeys();
const admin: SupabaseClient = createClient(keys.url, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });

async function demoUserIds(): Promise<string[]> {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const wanted = new Set<string>(Object.values(USERS));
  return (data?.users ?? []).filter((u) => u.email && wanted.has(u.email)).map((u) => u.id);
}

/** Demo kullanıcıların kilidini ve sayacını temizler, otomatik kilidi varsayılana döndürür. */
async function resetDemoLocks() {
  const ids = await demoUserIds();
  await admin.from("members").update({ locked_at: null, pin_failed: 0, auto_lock_minutes: 10 }).in("user_id", ids);
}

async function lockViaButton(page: Page) {
  await userMenuItem(page, "Paneli kilitle");
  await expect(page).toHaveURL(/\/kilit$/);
  await expect(page.getByRole("heading", { name: "Panel kilitli" })).toBeVisible();
}

test.afterEach(async () => {
  await resetDemoLocks();
});

test.describe("ilk giriş: PIN belirleme zorunlu", () => {
  const email = `pin-${Date.now().toString(36)}@demo.test`;
  let userId = "";

  test.beforeAll(async () => {
    const { data: tenant } = await admin.from("tenants").select("id").eq("name", "Demo Mağaza").limit(1).single();
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user || !tenant) throw new Error("test kullanıcısı oluşturulamadı");
    userId = created.data.user.id;
    const ins = await admin.from("members").insert({ tenant_id: tenant.id, user_id: userId, full_name: "Pin Deneme", role: "agent" });
    if (ins.error) throw new Error("test üyeliği oluşturulamadı");
  });

  test.afterAll(async () => {
    if (!userId) return;
    await admin.from("members").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
  });

  test("PIN'siz kullanıcı /pin-belirle'den geçemez; zayıf ve eşleşmeyen PIN reddedilir", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şifre").fill(PASSWORD);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/pin-belirle$/);

    await page.goto("/musteriler");
    await expect(page).toHaveURL(/\/pin-belirle$/);
    await page.goto("/kilit");
    await expect(page).toHaveURL(/\/pin-belirle$/);

    // zayıf PIN: DB mesajı
    await typePin(page, "123456");
    await expect(page.getByRole("heading", { name: "PIN'i tekrar gir" })).toBeVisible();
    await typePin(page, "123456");
    await expect(page.getByRole("alert").filter({ hasText: "kolay tahmin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "PIN belirle" })).toBeVisible();

    // eşleşmeme
    await typePin(page, "135790");
    await typePin(page, "135791");
    await expect(page.getByRole("alert").filter({ hasText: "aynı değil" })).toBeVisible();

    await typePin(page, "135790");
    await typePin(page, "135790");
    await expect(page).toHaveURL(/\/bugun/);
    await page.goto("/pin-belirle");
    await expect(page).toHaveURL(/\/bugun/);
  });
});

test.describe("kilit ve açma", () => {
  test("kilitle: yenileme ve adres çubuğu kilidi aşamaz; yanlış PIN hak düşer; doğru PIN açar", async ({ page }) => {
    await loginOk(page, "can");
    await lockViaButton(page);

    await page.reload();
    await expect(page).toHaveURL(/\/kilit$/);
    await page.goto("/musteriler");
    await expect(page).toHaveURL(/\/kilit$/);
    await page.goto("/bugun");
    await expect(page).toHaveURL(/\/kilit$/);

    await typePin(page, "975318");
    await expect(page.getByRole("alert").filter({ hasText: "4 hakkın kaldı" })).toBeVisible();

    // tuş takımı ile doğru PIN
    const pad = page.getByRole("group", { name: "PIN tuş takımı" });
    for (const d of TEST_PIN) await pad.getByRole("button", { name: d, exact: true }).click();
    await expect(page).toHaveURL(/\/bugun/);
    await page.goto("/kilit");
    await expect(page).toHaveURL(/\/bugun/);
  });

  test("5 yanlış PIN oturumu kapatır; e-posta + şifre ile giriş kilidi kaldırır", async ({ page }) => {
    await loginOk(page, "can");
    await lockViaButton(page);
    for (let i = 4; i >= 1; i--) {
      await typePin(page, "975318");
      await expect(page.getByRole("alert").filter({ hasText: `${i} hakkın kaldı` })).toBeVisible();
    }
    await typePin(page, "975318");
    await expect(page).toHaveURL(/\/giris\?hata=pin/);
    await page.goto("/bugun");
    await expect(page).toHaveURL(/\/giris$/);

    await login(page, "can");
    await expect(page).toHaveURL(/\/bugun/);
  });

  test("PIN'imi unuttum: girişe döner, şifreyle giriş kilidi kaldırır", async ({ page }) => {
    await loginOk(page, "can");
    await lockViaButton(page);
    await page.getByRole("button", { name: "PIN'imi unuttum" }).click();
    await expect(page).toHaveURL(/\/giris$/);
    await loginOk(page, "can");
  });
});

test.describe("mobil menü", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger menüde Paneli kilitle", async ({ page }) => {
    await loginOk(page, "ayse");
    await page.getByRole("button", { name: "Menüyü aç" }).click();
    await page.getByRole("navigation", { name: "Sayfa menüsü" }).getByRole("button", { name: "Paneli kilitle" }).click();
    await expect(page).toHaveURL(/\/kilit$/);
    await typePin(page, TEST_PIN);
    await expect(page).toHaveURL(/\/bugun/);
  });
});

test.describe("otomatik kilit ve çok sekme", () => {
  test("hareketsizlikte süre dolunca kilitlenir (sahte saat)", async ({ page }) => {
    const ids = await demoUserIds();
    await admin.from("members").update({ auto_lock_minutes: 5 }).in("user_id", ids);
    await page.clock.install();
    await loginOk(page, "ayse");
    await expect(page.getByRole("button", { name: "Hesap menüsü" })).toBeVisible();

    await page.clock.fastForward("03:00");
    await expect(page).toHaveURL(/\/bugun/);
    await page.clock.fastForward("02:30");
    await expect(page).toHaveURL(/\/kilit$/);
    await typePin(page, TEST_PIN);
    await expect(page).toHaveURL(/\/bugun/);
    // açıldıktan hemen sonra yeniden kilitlenmez
    await page.clock.fastForward("00:30");
    await expect(page).toHaveURL(/\/bugun/);
  });

  test("bir sekmede kilitlenince diğeri de kilit ekranına geçer; açılınca ikisi de döner", async ({ context }) => {
    const a = await context.newPage();
    await loginOk(a, "ayse");
    const b = await context.newPage();
    await b.goto("/musteriler");
    await expect(b).toHaveURL(/\/musteriler/);
    await expect(b.getByRole("button", { name: "Hesap menüsü" })).toBeVisible();

    await lockViaButton(a);
    await expect(b).toHaveURL(/\/kilit$/);

    await typePin(a, TEST_PIN);
    await expect(a).toHaveURL(/\/bugun/);
    await expect(b).toHaveURL(/\/bugun/);
  });
});

test.describe("profil güvenlik kartı", () => {
  test("yanlış mevcut PIN reddedilir; otomatik kilit süresi kaydedilir", async ({ page }) => {
    await loginOk(page, "elif");
    await page.goto("/profil");
    const card = page.locator(".card", { has: page.getByRole("heading", { name: "Güvenlik" }) });
    await card.getByLabel("Mevcut PIN").fill("999999");
    await card.getByLabel("Yeni PIN", { exact: true }).fill("135790");
    await card.getByLabel("Yeni PIN (tekrar)").fill("135790");
    await card.getByRole("button", { name: "PIN'i değiştir" }).click();
    await expect(page.getByText("Mevcut PIN hatalı.")).toBeVisible();

    await card.getByRole("combobox", { name: "Otomatik kilit" }).click();
    await page.getByRole("option", { name: "15 dakika" }).click();
    await expect(page.getByText("Panel 15 dakika hareketsizlikte kilitlenir.")).toBeVisible();
    await page.reload();
    await expect(page.locator(".card", { has: page.getByRole("heading", { name: "Güvenlik" }) }).getByRole("combobox", { name: "Otomatik kilit" })).toContainText("15 dakika");
  });
});
