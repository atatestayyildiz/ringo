import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { loginOk, openLogin, PASSWORD, TEST_PIN, typePin, userMenuItem, USERS } from "./helpers";

// Bu dosya sahne animasyonunun kendisini sınar: genel "reduce" ayarını kapat.
test.use({ reducedMotion: "no-preference" });
// Neon akış donanım GL ister (yazılım GL'de sahne neon'u kapatır); GPU yalnız bu dosyada açık.
test.use({ launchOptions: { args: ["--enable-gpu", "--ignore-gpu-blocklist"] } });

// Giriş / kilit sahnesi (2026-10-05 tasarım turu): logo tam ortada, alt ortada "Giriş yap" / "PIN gir",
// kart ve çizilen daireler, kapı katmanı sonunda DOM'dan kalkar, neon akış yerel paketten (CDN yok).

function admin() {
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return createClient(j.API_URL as string, (j.SERVICE_ROLE_KEY ?? j.SECRET_KEY) as string, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.afterEach(async () => {
  // Demo hesapları kilitli bırakılmaz.
  const db = admin();
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  const ids = (data?.users ?? []).filter((u) => u.email && Object.values(USERS).includes(u.email as never)).map((u) => u.id);
  await db.from("members").update({ locked_at: null, pin_failed: 0 }).in("user_id", ids);
});

/** Logo (amblem) merkezinin görünür alan merkezine uzaklığı. */
async function emblemOffset(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-scene-emblem]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { dx: r.left + r.width / 2 - innerWidth / 2, dy: r.top + r.height / 2 - innerHeight / 2 };
  });
}

async function expectCentered(page: Page) {
  // giriş koreografisi (ölçek) bitsin
  await expect.poll(async () => page.evaluate(() => document.querySelector("[data-scene-emblem]")?.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity && a.playState === "running").length ?? 1)).toBe(0);
  const o = await emblemOffset(page);
  expect(o).not.toBeNull();
  expect(Math.abs(o!.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(o!.dy)).toBeLessThanOrEqual(2);
}

for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test(`logo ${vp.width}x${vp.height} görünür alanın tam ortasında; kart açılınca yerinden oynamaz`, async ({ browser }) => {
    const mobile = vp.width < 500;
    const context = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    await page.goto("/giris");
    await expectCentered(page);
    await expect(page.getByLabel("E-posta")).toHaveCount(0);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByLabel("E-posta")).toBeFocused();
    await expectCentered(page);
    // kart logonun altında, ekranın alt yarısında
    const card = await page.getByRole("form", { name: "Giriş" }).boundingBox();
    expect(card!.y).toBeGreaterThan(vp.height / 2);
    expect(card!.y + card!.height).toBeLessThanOrEqual(vp.height);
    await context.close();
  });
}

test("kilit ekranında logo ortada (mobil 390x844)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await loginOk(page, "elif");
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  await page.getByRole("navigation", { name: "Sayfa menüsü" }).getByRole("button", { name: "Paneli kilitle" }).click();
  await expect(page).toHaveURL(/\/kilit$/);
  await expect(page.getByTestId("door")).toHaveCount(0);
  await expectCentered(page);
  await context.close();
});

test("Giriş yap: kart belirir; yanlışta kart kalır ve Türkçe hata; doğruda kart söner, sonra kapı; kapı DOM'dan kalkar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/giris");
  await openLogin(page);
  const form = page.getByRole("form", { name: "Giriş" });
  await expect(page.getByLabel("E-posta")).toHaveAttribute("inputmode", "email");
  await page.getByLabel("E-posta").fill(USERS.yonetici);
  await page.getByLabel("Şifre").fill("YanlisSifre1!");
  await page.getByLabel("Şifre").press("Enter");
  await expect(form.getByRole("alert")).toContainText("E-posta veya şifre hatalı");
  await expect(form).toBeVisible();
  await expect(page).toHaveURL(/\/giris/);

  // Kapı aşamaları + kartın görünürlüğü zaman damgasıyla
  await page.evaluate(() => {
    const w = window as unknown as { __log: [string, number][] };
    w.__log = [];
    const t0 = performance.now();
    const push = (k: string) => w.__log.push([k, Math.round(performance.now() - t0)]);
    new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target as HTMLElement;
        if (m.type === "attributes" && t.dataset?.testid === "door") push(`door:${t.dataset.stage}`);
      }
      const f = document.querySelector('form[aria-label="Giriş"]');
      if (f && Number(getComputedStyle(f.parentElement!).opacity) < 0.05 && !w.__log.some(([k]) => k === "card:hidden")) push("card:hidden");
    }).observe(document, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-stage", "style"] });
    const poll = () => {
      const f = document.querySelector('form[aria-label="Giriş"]');
      if (f && Number(getComputedStyle(f.parentElement!).opacity) < 0.05 && !w.__log.some(([k]) => k === "card:hidden")) push("card:hidden");
      if (!w.__log.some(([k]) => k === "card:hidden")) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  const t0 = Date.now();
  await page.getByLabel("E-posta").fill(USERS.yonetici);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/bugun/);
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 15_000 });
  const total = Date.now() - t0;
  const log = await page.evaluate(() => (window as unknown as { __log: [string, number][] }).__log);
  const at = (k: string) => log.find(([x]) => x === k)?.[1] ?? -1;
  // kart önce söner, kapı (örtü + ışınlar) ondan sonra başlar
  expect(at("card:hidden")).toBeGreaterThanOrEqual(0);
  expect(at("door:lines")).toBeGreaterThan(at("card:hidden"));
  // uzatılmış koreografi: söner + parlar + ışınlar + ayrılma ≈ 3.3 sn (+ gezinme)
  expect(total).toBeGreaterThanOrEqual(3000);
  test.info().annotations.push({ type: "süre", description: `giriş → kapı kalktı: ${total} ms; aşamalar ${JSON.stringify(log)}` });
  // kapı kalktıktan sonra panel etkileşime açık
  await page.getByRole("link", { name: /Müşteriler/ }).first().click();
  await expect(page).toHaveURL(/\/musteriler/);
});

test("PIN gir: daireler çizilir, gizli alan sayısal klavye ister; yanlışta kalan hak, doğruda kapı açılır ve kalkar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginOk(page, "can");
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 15_000 });
  await userMenuItem(page, "Paneli kilitle");
  await expect(page).toHaveURL(/\/kilit$/);
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 15_000 });

  // ekranda tuş takımı yok
  await expect(page.getByRole("group", { name: /tuş takımı/ })).toHaveCount(0);
  const input = page.getByLabel("PIN", { exact: true });
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveAttribute("pattern", "[0-9]*");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await page.getByRole("button", { name: "PIN gir" }).click();
  await expect(input).toBeFocused();
  // daireler çiziliyor (stroke-dashoffset 100 → 0)
  await expect
    .poll(() => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="pin-dots"] circle[pathLength]')).map((c) => Number(getComputedStyle(c).strokeDashoffset.replace("px", "")))))
    .toEqual([0, 0, 0, 0, 0, 0]);

  await input.pressSequentially("97531");
  await expect(page.getByTestId("pin-dots")).toHaveAttribute("data-filled", "5");
  await input.press("8");
  await expect(page.getByRole("alert").filter({ hasText: "4 hakkın kaldı" })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();

  await typePin(page, TEST_PIN);
  await expect(page).toHaveURL(/\/bugun/);
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 15_000 });
});

test("vurgu rengi: avatar zemini ve kilit sahnesi çizgileri kişisel vurgudan", async ({ page }) => {
  await loginOk(page, "can");
  const brand = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--brand)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  const avatarBg = await page.getByRole("button", { name: "Hesap menüsü" }).locator(".avatar").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(avatarBg).toBe(brand);
  await userMenuItem(page, "Paneli kilitle");
  await expect(page).toHaveURL(/\/kilit$/);
  const ring = await page.locator("[data-scene-emblem] [data-a='ring1'] circle").first().evaluate((el) => getComputedStyle(el).stroke);
  expect(ring).toBe(brand);
});

test("neon akış yerel paketten yüklenir: jsdelivr ya da başka CDN isteği yok", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname)) external.push(r.url());
  });
  await page.goto("/giris");
  await expect(page.getByTestId("neon-flow").locator("[data-neon]")).toHaveAttribute("data-neon", "ready", { timeout: 20_000 });
  await expect(page.getByTestId("neon-flow").locator("canvas")).toHaveCount(1);
  // ön katmanlar tıklanabilir: kart açılır
  await openLogin(page);
  expect(external.filter((u) => u.includes("jsdelivr"))).toEqual([]);
  expect(external).toEqual([]);
});

test("azaltılmış hareket: neon akış yok, koyu zemin; giriş kartı ve PIN daireleri çalışır", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/giris");
  await expect(page.locator("[data-scene-emblem]")).toBeVisible();
  await expect(page.getByTestId("neon-flow")).toHaveCount(0);
  const bg = await page.locator("[data-scene-emblem]").evaluate((el) => getComputedStyle(el.closest("[data-mode]")!).backgroundColor);
  expect(bg).toBe("rgb(6, 6, 9)");
  await openLogin(page);
  await page.getByLabel("E-posta").fill(USERS.ayse);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/bugun/);
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 5_000 });
  await userMenuItem(page, "Paneli kilitle");
  await expect(page).toHaveURL(/\/kilit$/);
  await expect(page.getByTestId("neon-flow")).toHaveCount(0);
  await typePin(page, TEST_PIN);
  await expect(page).toHaveURL(/\/bugun/);
});

test("dışarı dokunma ve Escape: kart ve PIN daireleri kapanır, metin düğmesi geri gelir; neon renk tıklaması tetiklenmez", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/giris");
  await expect(page.getByTestId("neon-flow").locator("[data-neon]")).toHaveAttribute("data-neon", "ready", { timeout: 20_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __neonClicks: number };
    w.__neonClicks = 0;
    document.querySelector('[data-testid="neon-flow"] [data-neon]')!.addEventListener("click", () => w.__neonClicks++);
  });
  const neonClicks = () => page.evaluate(() => (window as unknown as { __neonClicks: number }).__neonClicks);
  const form = page.getByRole("form", { name: "Giriş" });

  await openLogin(page);
  await page.mouse.click(120, 450); // boş sahne
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
  expect(await neonClicks()).toBe(0);

  await openLogin(page);
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();

  // kart kapalıyken boş sahneye tıklama neon akışa ulaşır (renk karıştırma)
  await page.mouse.click(120, 450);
  expect(await neonClicks()).toBe(1);

  // PIN daireleri: kilit ekranı
  await openLogin(page);
  await page.getByLabel("E-posta").fill(USERS.elif);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/bugun/);
  await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 15_000 });
  await userMenuItem(page, "Paneli kilitle");
  await expect(page).toHaveURL(/\/kilit$/);
  // başlık ve açıklama görünmez (yalnız ekran okuyucu)
  const head = await page.getByRole("heading", { name: "Panel kilitli" }).boundingBox();
  expect(head!.width).toBeLessThanOrEqual(1);
  const field = page.locator("[data-revealed]");
  const pin = page.getByLabel("PIN", { exact: true });
  await page.getByRole("button", { name: "PIN gir" }).click();
  await expect(pin).toBeFocused();
  await pin.pressSequentially("12");
  await page.mouse.click(120, 450);
  await expect(field).toHaveCount(0);
  await expect(pin).not.toBeFocused();
  await expect(pin).toHaveValue("");
  await expect(page.getByRole("button", { name: "PIN gir" })).toBeVisible();
  await page.getByRole("button", { name: "PIN gir" }).click();
  await expect(pin).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await typePin(page, TEST_PIN);
  await expect(page).toHaveURL(/\/bugun/);
});
