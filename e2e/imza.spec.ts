import { expect, test } from "@playwright/test";
import { loginOk } from "./helpers";

const link = (page: import("@playwright/test").Page) =>
  page.getByRole("link", { name: "MoonWorks web sitesi (yeni sekmede açılır)" });

async function expectSignature(page: import("@playwright/test").Page) {
  const a = link(page);
  await expect(a).toBeVisible();
  await expect(a).toHaveAttribute("href", "https://moonworks.com.tr");
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", /noopener/);
  await expect(a.locator("img").first()).toHaveAttribute("alt", "MoonWorks");
}

test("giriş ve şifre sıfırlama sayfalarında imza görünür", async ({ page }) => {
  await page.goto("/giris");
  await expectSignature(page);
  await page.goto("/sifre-sifirla");
  await expectSignature(page);
});

test("Bugün sayfasında imza görünür; koyu temada koyu logo", async ({ page }) => {
  await loginOk(page, "yonetici");
  await expectSignature(page);
  const imgs = link(page).locator("img");
  await expect(imgs.nth(0)).toBeVisible();
  await expect(imgs.nth(1)).toBeHidden();
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect(imgs.nth(0)).toBeHidden();
  await expect(imgs.nth(1)).toBeVisible();
});

test.describe("mobil 375", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("imza alttaki yüzen menüyle çakışmaz", async ({ page }) => {
    await loginOk(page, "yonetici");
    await link(page).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const a = await link(page).boundingBox();
    const nav = await page.locator("nav.nav").boundingBox();
    expect(a).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(a!.y + a!.height).toBeLessThanOrEqual(nav!.y);
    await expect(link(page)).toBeInViewport({ ratio: 1 });
  });
});
