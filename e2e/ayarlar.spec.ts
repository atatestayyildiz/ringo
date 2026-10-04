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
  await expect(page.locator(".logo-mark img")).toHaveCount(0);
});
