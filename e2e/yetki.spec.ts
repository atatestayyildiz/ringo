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
    for (const name of ["Bugün", "Müşteriler", "Havuz", "Huni", "Yönetim", "Ayarlar"]) {
      await expect(nav(page, name)).toBeVisible();
    }
    await page.goto("/ayarlar");
    await expect(page).toHaveURL(/\/ayarlar/);
  });
});
