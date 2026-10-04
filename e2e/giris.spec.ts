import { expect, test } from "@playwright/test";
import { login, loginOk, logout } from "./helpers";

test.describe("giriş", () => {
  test("oturumsuz kullanıcı giriş sayfasına yönlenir", async ({ page }) => {
    for (const path of ["/bugun", "/musteriler", "/ayarlar"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/giris/);
    }
    await expect(page.getByLabel("E-posta")).toBeVisible();
  });

  test("giriş sayfası marka adını gösterir", async ({ page }) => {
    await page.goto("/giris");
    await expect(page.getByTestId("login-brand")).toBeVisible();
    await expect(page.getByTestId("login-brand")).not.toHaveText("");
  });

  test("yanlış şifre hata verir, oturum açmaz", async ({ page }) => {
    await login(page, "yonetici", "YanlisSifre1!");
    await expect(page.locator(".form-error")).toContainText("E-posta veya şifre hatalı");
    await expect(page).toHaveURL(/\/giris/);
  });

  test("doğru şifre Bugün'e götürür, çıkış oturumu kapatır", async ({ page }) => {
    await loginOk(page, "elif");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await logout(page);
    await page.goto("/bugun");
    await expect(page).toHaveURL(/\/giris/);
  });
});
