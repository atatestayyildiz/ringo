import { expect, test, type Page } from "@playwright/test";
import { loginOk } from "./helpers";

// Operatör adının önündeki logo: img var ve yazı boyunu aşmıyor (≈1em).
async function expectSmallLogos(page: Page) {
  const logos = page.locator('img[src^="/operators/"]');
  await expect(logos.first()).toBeVisible();
  const r = await logos.first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { h: b.height, w: b.width, fs: parseFloat(getComputedStyle(el).fontSize) };
  });
  expect(r.h).toBeGreaterThan(0);
  expect(r.h).toBeLessThanOrEqual(r.fs * 1.11);
  expect(r.w).toBeLessThanOrEqual(r.fs * 1.11);
}

test("Müşteriler listesinde operatör logosu var", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/musteriler");
  await expectSmallLogos(page);
});

test("Bugün ekranında operatör logosu var", async ({ page }) => {
  await loginOk(page, "elif");
  await page.goto("/bugun");
  await page.waitForLoadState("networkidle");
  if ((await page.locator('img[src^="/operators/"]').count()) === 0) {
    const dagit = page.getByRole("button", { name: "Dağıt" });
    if (await dagit.count()) {
      await loginOk(page, "yonetici");
      await page.goto("/bugun");
      await page.getByRole("button", { name: "Dağıt" }).click();
      await page.waitForLoadState("networkidle");
      await loginOk(page, "elif");
      await page.goto("/bugun");
    }
  }
  await expectSmallLogos(page);
});
