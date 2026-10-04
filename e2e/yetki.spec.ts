import { expect, test, type Page } from "@playwright/test";
import { loginOk } from "./helpers";

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name });

test.describe("yetki", () => {
  test("çalışan Ayarlar'a giremez, Bugün'e yönlenir", async ({ page }) => {
    await loginOk(page, "elif");
    await expect(nav(page, "Ayarlar")).toHaveCount(0);
    await page.goto("/ayarlar");
    await expect(page).toHaveURL(/\/bugun/);
  });

  test("içe aktarma yetkisi olmayan çalışan içe aktarmayı göremez", async ({ page }) => {
    await loginOk(page, "ayse");
    await page.goto("/musteriler");
    await expect(page.getByRole("heading", { name: "Müşteriler", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Excel içe aktar" })).toHaveCount(0);
    await page.goto("/musteriler/ice-aktar");
    await expect(page).toHaveURL(/\/bugun/);
  });

  test("yönetici tüm menüleri görür", async ({ page }) => {
    await loginOk(page, "yonetici");
    for (const name of ["Bugün", "Müşteriler", "Havuz", "Huni", "Yönetim", "Raporlar", "Ayarlar"]) {
      await expect(nav(page, name)).toBeVisible();
    }
    await page.goto("/ayarlar");
    await expect(page).toHaveURL(/\/ayarlar/);
  });

  test("yetkisiz çalışan Raporlar'ı yalnız kendi kapsamıyla görür, Yönetim'e giremez", async ({ page }) => {
    await loginOk(page, "ayse");
    await expect(nav(page, "Raporlar")).toBeVisible();
    await expect(nav(page, "Yönetim")).toHaveCount(0);
    await page.goto("/yonetim");
    await expect(page).toHaveURL(/\/bugun/);
    await page.goto("/raporlar");
    await expect(page.getByRole("heading", { name: "Raporlar", level: 1 })).toBeVisible();
    await expect(page.getByText("Yalnız sizin sonuçlarınız.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Çalışanlar" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Rapor kapsamı" })).toHaveCount(0);
    await expect(page.getByText("Raporu indir (CSV)")).toHaveCount(0);
  });

  test("view_reports ve view_team olan çalışan ekip raporunu ve Yönetim'i görür", async ({ page }) => {
    await loginOk(page, "elif");
    await expect(nav(page, "Raporlar")).toBeVisible();
    await expect(nav(page, "Yönetim")).toBeVisible();
    await page.goto("/raporlar");
    const scope = page.getByRole("navigation", { name: "Rapor kapsamı" });
    await expect(scope.getByRole("link", { name: "Ekip" })).toHaveAttribute("aria-current", "true");
    await scope.getByRole("link", { name: "Ben" }).click();
    await expect(page).toHaveURL(/kapsam=ben/);
    await expect(page.getByRole("heading", { name: "Çalışanlar" })).toHaveCount(0);
  });
});
