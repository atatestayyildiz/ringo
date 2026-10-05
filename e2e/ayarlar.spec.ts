import { expect, test } from "@playwright/test";
import { loginOk } from "./helpers";

test("kural değişince kayıtlı özet değişir ve geri alınır", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");

  const field = page.getByLabel("Havuzda bekleme (gün)");
  const saved = page.getByTestId("rules-saved");
  const original = await field.inputValue();
  const before = (await saved.innerText()).trim();
  const changed = String(Number(original) === 9 ? 8 : 9);

  const save = async (value: string) => {
    await field.fill(value);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Kurallar kaydedildi.")).toBeVisible();
  };

  try {
    await save(changed);
    await expect(saved).toContainText(`${changed} gün sonra`);
    await expect(saved).not.toHaveText(before);
  } finally {
    await field.fill(original);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(saved).toHaveText(before);
  }
});

test("logo adresi yalnız https kabul edilir", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await page.getByText("Marka", { exact: true }).click();
  await page.getByPlaceholder("https://").fill("http://example.test/logo.png");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Logo adresi https:// ile başlayan geçerli bir bağlantı olmalı.")).toBeVisible();
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("logo dosyası yüklenir, kabukta ve girişte görünür, kaldırılır; SVG ve sahte dosya reddedilir", async ({ page, browser }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await page.getByText("Marka", { exact: true }).click();

  const input = page.getByLabel("Logo dosyası seç");
  try {
    // SVG ve uzantısı png olan sahte içerik reddedilir
    await input.setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await expect(page.getByText("Yalnız PNG, JPEG veya WebP yüklenebilir.")).toBeVisible();
    await input.setInputFiles({ name: "sahte.png", mimeType: "image/png", buffer: Buffer.from("<html>bu png degil</html>") });
    await expect(page.getByText("Yalnız PNG, JPEG veya WebP yüklenebilir.").first()).toBeVisible();

    await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG_1X1 });
    await expect(page.getByText("Logo yüklendi.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Logoyu kaldır" })).toBeVisible();

    // Kabuk (üst sol) ve giriş sayfası yüklenen logoyu kullanır
    await page.reload();
    await expect(page.locator(".logo-mark img").first()).toHaveAttribute("src", /\/storage\/v1\/object\/public\/brand-logos\//);
    const { context, page: anon } = await (async () => {
      const c = await browser.newContext();
      return { context: c, page: await c.newPage() };
    })();
    await anon.goto("/giris");
    await expect(anon.getByTestId("login-brand").locator("img")).toHaveAttribute("src", /\/storage\/v1\/object\/public\/brand-logos\//);
    await context.close();
  } finally {
    await page.goto("/ayarlar");
    await page.getByText("Marka", { exact: true }).click();
    const remove = page.getByRole("button", { name: "Logoyu kaldır" });
    if (await remove.isVisible()) {
      await remove.click();
      await expect(page.getByText("Logo kaldırıldı.")).toBeVisible();
    }
  }
  await page.reload();
  // Logo kaldırılınca ürün varsayılanı (Ringo) görünür
  await expect(page.locator(".logo-mark img").first()).toHaveAttribute("src", "/ringo-logo.png");
});

test("bildirim sekmesinden gönderim saatleri değişir, Kurallar'da saat alanı yok", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await expect(page.getByLabel("Sabah dağıtım saati")).toHaveCount(0);
  await page.getByRole("button", { name: "Bildirimler", exact: true }).click();

  const morning = page.getByRole("textbox", { name: "Sabah listesi" });
  const original = await morning.inputValue();
  expect(original).toMatch(/^\d{2}:\d{2}$/);
  const changed = original === "08:30" ? "08:45" : "08:30";
  const save = async (value: string) => {
    await morning.fill(value);
    await page.getByRole("button", { name: "Saatleri kaydet" }).click();
    await expect(page.getByText("Gönderim saatleri kaydedildi.")).toBeVisible();
  };
  try {
    await morning.fill("24:00");
    await expect(page.getByText("Saati SS:DD biçiminde girin, örneğin 08:30.")).toBeVisible();
    await morning.fill("0861");
    await expect(morning).toHaveValue("08:61");
    await expect(page.getByText("Saati SS:DD biçiminde girin, örneğin 08:30.")).toBeVisible();
    await save(changed);
    await page.reload();
    await page.getByRole("button", { name: "Bildirimler", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Sabah listesi" })).toHaveValue(changed);
  } finally {
    await page.getByRole("textbox", { name: "Sabah listesi" }).fill(original);
    await page.getByRole("button", { name: "Saatleri kaydet" }).click();
    await expect(page.getByText("Gönderim saatleri kaydedildi.").first()).toBeVisible();
  }
});

for (const viewport of [
  { name: "masaüstü", width: 1280, height: 800 },
  { name: "mobil", width: 375, height: 812 },
]) {
  test(`çalışan ekle: Öner ve Kopyala geçici şifre alanıyla aynı hizada (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginOk(page, "yonetici");
    await page.goto("/ayarlar");
    await page.getByRole("button", { name: "Ekip", exact: true }).click();
    await page.getByRole("button", { name: "Çalışan ekle" }).first().click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByLabel("Geçici şifre");
    await expect(input).toBeVisible();
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    for (const name of ["Öner", "Kopyala"]) {
      const b = await dialog.getByRole("button", { name, exact: true }).boundingBox();
      expect(b).not.toBeNull();
      expect(Math.abs(b!.y - box!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(b!.y + b!.height - (box!.y + box!.height))).toBeLessThanOrEqual(2);
      expect(b!.x + b!.width).toBeLessThanOrEqual(viewport.width);
    }
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
  });
}

test("çalışan eklenir, pasifleştirilir ve kalıcı silinir (giriş hesabı da gider)", async ({ page }) => {
  const email = `silinecek-${Date.now()}@demo.test`;
  page.on("dialog", (d) => void d.accept());
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await page.getByRole("button", { name: "Ekip", exact: true }).click();
  await page.getByRole("button", { name: "Çalışan ekle" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ad soyad").fill("Silinecek Deneme");
  await dialog.getByLabel("E-posta").fill(email);
  await dialog.getByLabel("Geçici şifre").fill("Deneme-Sifre-1");
  await dialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(dialog.getByText("Çalışan eklendi")).toBeVisible();
  // Kapatma, sunucu yenilemesi bitene kadar yok sayılır: kapanana kadar tekrar dene
  await expect(async () => {
    await dialog.getByRole("button", { name: "Tamam" }).click({ timeout: 2000 });
    await expect(dialog).toBeHidden({ timeout: 1500 });
  }).toPass({ timeout: 15000 });

  const row = page.locator(`[data-member="${email}"]`);
  await expect(row).toBeVisible();
  // Aktifken Sil düğmesi yok
  await expect(row.getByRole("button", { name: "Sil", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Pasifleştir" }).click();
  await expect(row.getByText("Pasif")).toBeVisible();
  await row.getByRole("button", { name: "Sil", exact: true }).click();
  await expect(page.locator(`[data-member="${email}"]`)).toHaveCount(0);
  await expect(page.getByText("Silinecek Deneme silindi.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Ekip", exact: true }).click();
  await expect(page.getByText("Silinecek Deneme", { exact: true })).toHaveCount(0);
});
