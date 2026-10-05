import { expect, test } from "@playwright/test";
import { loginOk } from "./helpers";

test.describe("kabuk: mobil menü çekmecesi", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger açılır, yazılı menü görünür, Escape kapatır, link gider", async ({ page }) => {
    await loginOk(page, "yonetici");
    const btn = page.getByRole("button", { name: "Menüyü aç" });
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");

    const drawer = page.getByRole("dialog", { name: "Menü" });
    await expect(drawer).toBeVisible();
    const nav = drawer.getByRole("navigation", { name: "Sayfa menüsü" });
    for (const name of ["Bugün", "Müşteriler", "Havuz", "Huni", "Yönetim", "Raporlar", "Ayarlar", "Profil", "Çıkış yap"]) {
      await expect(nav.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Bugün" })).toHaveAttribute("aria-current", "page");
    // odak çekmeceye girer, arka plan kaydırılmaz
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".drawer"))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(btn).toBeFocused();

    // dışarı tıklayınca kapanır
    await btn.click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(360, 400);
    await expect(drawer).toBeHidden();

    // link tıklayınca gider ve kapanır
    await btn.click();
    await page.getByRole("dialog", { name: "Menü" }).getByRole("link", { name: "Müşteriler" }).click();
    await expect(page).toHaveURL(/\/musteriler/);
    await expect(page.getByRole("dialog", { name: "Menü" })).toBeHidden();
  });

  test("çekmeceden çıkış onay diyaloğunu açar; çalışanda yetkisiz sayfalar yok", async ({ page }) => {
    await loginOk(page, "ayse");
    await page.getByRole("button", { name: "Menüyü aç" }).click();
    const nav = page.getByRole("navigation", { name: "Sayfa menüsü" });
    await expect(nav.getByText("Ayarlar", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("Yönetim", { exact: true })).toHaveCount(0);
    await nav.getByRole("button", { name: "Çıkış yap" }).click();
    await expect(page.getByRole("dialog", { name: "Çıkış yapılsın mı?" })).toBeVisible();
  });
});

test.describe("kabuk: masaüstü", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hamburger görünmez, kaydırınca üst menü ekranın üstünde kalır", async ({ page }) => {
    await loginOk(page, "yonetici");
    await expect(page.getByRole("button", { name: "Menüyü aç" })).toBeHidden();
    await page.evaluate(() => {
      const s = document.createElement("div");
      s.style.height = "3000px";
      document.querySelector("main")?.appendChild(s);
    });
    await page.evaluate(() => window.scrollTo(0, 1000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(900);
    const header = page.locator("header.top");
    await expect(header).toBeInViewport({ ratio: 1 });
    const top = await header.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
  });
});

for (const vp of [
  { name: "masaüstü", width: 1440, height: 900 },
  { name: "mobil", width: 375, height: 812 },
]) {
  test.describe(`kabuk: hesap menüsü (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("avatar menüsü: klavye, Escape, dışarı tıklama, tema ve profil", async ({ page }) => {
      await loginOk(page, "elif");
      const trigger = page.getByRole("button", { name: "Hesap menüsü" });
      await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.click();
      const menu = page.getByRole("menu", { name: "Hesap" });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const items = menu.getByRole("menuitem");
      await expect(items).toHaveText(["Profil", /(Koyu|Açık) tema/, "Paneli kilitle", "Çıkış yap"]);
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      await expect(items.last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();

      // dışarı tıklayınca kapanır
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(10, vp.height - 10);
      await expect(menu).toBeHidden();

      // tema: menü açık kalır, etiket değişir
      await trigger.click();
      const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
      await menu.getByRole("menuitem", { name: /tema$/ }).click();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
      await expect(menu).toBeVisible();
      await page.evaluate(() => {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem("theme");
      });

      await menu.getByRole("menuitem", { name: "Profil" }).click();
      await expect(page).toHaveURL(/\/profil/);
    });
  });
}

test("hesap menüsü: karartma katmanına tıklayınca kapanır", async ({ page }) => {
  await loginOk(page, "ayse");
  const trigger = page.getByRole("button", { name: "Hesap menüsü" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Hesap" });
  await expect(menu).toBeVisible();
  const scrim = page.getByTestId("user-menu-scrim");
  await expect(scrim).toHaveCSS("opacity", "1");
  await page.mouse.click(200, 600);
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/\/bugun/);
});
