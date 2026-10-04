import { expect, test } from "@playwright/test";

test("oturumsuz kullanıcı giriş sayfasına yönlenir", async ({ page }) => {
  await page.goto("/bugun");
  await expect(page).toHaveURL(/\/giris/);
  await expect(page.getByLabel("E-posta")).toBeVisible();
});
