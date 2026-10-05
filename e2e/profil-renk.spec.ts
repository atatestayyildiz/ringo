import { expect, test, type Page } from "@playwright/test";
import { loginOk } from "./helpers";

const brandVar = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim().toLowerCase());
const neutralVar = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-neutral").trim().toLowerCase());

async function resetAccent(page: Page) {
  await page.goto("/profil");
  const def = page.getByRole("radio", { name: "Varsayılan" });
  if (!(await def.isChecked())) {
    await def.check();
    await expect(page.getByText("Varsayılan renge dönüldü.")).toBeVisible();
  }
}

test.describe("profil: arayüz rengi", () => {
  test("satışçı rengi seçer, yenileyince korunur, Varsayılan nötre döner", async ({ page }) => {
    await page.goto("/giris");
    const storeBrand = await brandVar(page);

    await loginOk(page, "ayse");
    try {
      await resetAccent(page);
      const neutral = await neutralVar(page);
      expect(neutral).toMatch(/^#[0-9a-f]{6}$/);
      expect(await brandVar(page)).toBe(neutral);
      expect(neutral).not.toBe(storeBrand);

      const group = page.getByRole("radiogroup", { name: "Arayüz rengi" });
      await expect(group.getByRole("radio")).toHaveCount(14);

      await page.getByRole("radio", { name: "Mor" }).check();
      await expect(page.getByText("Arayüz rengi kaydedildi.")).toBeVisible();
      expect(await brandVar(page)).toBe("#9333ea");

      await page.reload();
      await expect(page.getByRole("radio", { name: "Mor" })).toBeChecked();
      expect(await brandVar(page)).toBe("#9333ea");
      await page.goto("/bugun");
      expect(await brandVar(page)).toBe("#9333ea");

      // Mağaza rengi açıkça seçilebilir
      await page.goto("/profil");
      await page.getByRole("radio", { name: "Mağaza rengi" }).check();
      await expect(page.getByText("Arayüz rengi kaydedildi.")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("radio", { name: "Mağaza rengi" })).toBeChecked();
      expect(await brandVar(page)).toBe(storeBrand);

      await page.getByRole("radio", { name: "Varsayılan" }).check();
      await expect(page.getByText("Varsayılan renge dönüldü.")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("radio", { name: "Varsayılan" })).toBeChecked();
      expect(await brandVar(page)).toBe(neutral);
    } finally {
      await resetAccent(page);
    }
  });

  test("yöneticinin varsayılanı marka rengi", async ({ page }) => {
    await page.goto("/giris");
    const storeBrand = await brandVar(page);
    await loginOk(page, "yonetici");
    try {
      await resetAccent(page);
      await expect(page.getByRole("radio", { name: "Varsayılan" })).toBeChecked();
      expect(await brandVar(page)).toBe(storeBrand);
    } finally {
      await resetAccent(page);
    }
  });

  test("Bildirimler kartı (Push): yönetici ve satışçının Profil'inde, yöneticinin Ayarlar > Bildirimler'inde görünür", async ({ page }) => {
    // Gerçek push çalıştırılmaz: yalnız kart başlığı ve düğme/rehber görünürlüğü.
    await loginOk(page, "yonetici");
    await page.goto("/profil");
    await expect(page.getByRole("heading", { name: "Bildirimler", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Geri arama vakti" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Randevu hatırlatma" })).toBeVisible();
    await page.goto("/ayarlar");
    await page.getByRole("button", { name: "Bildirimler", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Hangi bildirimler gönderilir" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bu cihazdaki bildirimlerim" })).toBeVisible();
    await page.context().clearCookies();
    await loginOk(page, "ayse");
    await page.goto("/profil");
    await expect(page.getByRole("heading", { name: "Bildirimler", exact: true })).toBeVisible();
    // Masaüstü tarayıcıda durum: aç düğmesi, desteklenmiyor ya da izin uyarısı (hangisi olursa).
    await expect(
      page
        .getByRole("button", { name: "Bu cihazda bildirimleri aç" })
        .or(page.getByText(/desteklemiyor|bildirim izni kapalı|Bu cihazda açık/i)),
    ).toBeVisible();
  });
});
