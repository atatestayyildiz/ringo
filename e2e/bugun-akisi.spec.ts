import { expect, test, type Browser, type Page } from "@playwright/test";
import { AGENTS, deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag, type UserKey } from "./helpers";

// Dört kurgusal müşteri: A havuza düşer, B huniye girer, C geri arama doğrulaması ve mobil testleri için bekler, D yarına ertelenir.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const names = { a: `Ayla ${tag}a`, b: `Bora ${tag}b`, c: `Ceren ${tag}c`, d: `Deniz ${tag}d` };
const owners: Partial<Record<keyof typeof names, UserKey>> = {};

const slot = (page: Page, name: string) =>
  page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button", { name: new RegExp(name) });

/** Müşteriyi bugünün listesinde tutan çalışanı bulur (sırayla her çalışanla giriş yapar). */
async function findOwner(browser: Browser, name: string): Promise<UserKey> {
  for (const who of AGENTS) {
    const { context, page } = await freshPage(browser);
    try {
      await loginOk(page, who);
      if ((await slot(page, name).count()) > 0) return who;
    } finally {
      await context.close();
    }
  }
  throw new Error(`${name} hiçbir çalışanın listesinde değil`);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    const csv = [
      "Ad Soyad;Telefon",
      `${names.a};${uniquePhone()}`,
      `${names.b};${uniquePhone()}`,
      `${names.c};${uniquePhone()}`,
      `${names.d};${uniquePhone()}`,
    ].join("\n");
    const res = await importCsv(page, Buffer.from(csv, "utf-8"));
    expect(res.inserted).toBe(4);

    await page.goto("/bugun");
    await page.getByRole("button", { name: "Dağıt" }).click();
    await expect(page.getByText(/müşteri dağıtıldı|Dağıtılacak yeni müşteri yok/)).toBeVisible();
  } finally {
    await context.close();
  }
  for (const k of ["a", "b", "c", "d"] as const) owners[k] = await findOwner(browser, names[k]);
});

test.afterAll(async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    await deleteByTag(page, tag);
  } finally {
    await context.close();
  }
});

test("3 kez Açmadı müşteriyi havuza düşürür ve Havuz'da görünür", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await loginOk(page, owners.a!);

  for (let i = 0; i < 10; i++) {
    await slot(page, names.a).click();
    const label = (await slot(page, names.a).getAttribute("aria-label")) ?? "";
    if (/Havuzda/.test(label)) break;
    // Ekran önce geçici "Tekrar ara" gösterir; kesin durum için server action yanıtını bekle
    const done = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/bugun");
    await page.getByRole("button", { name: /Açmadı/ }).click();
    await done;
    await expect(slot(page, names.a)).toHaveAccessibleName(/Tekrar ara|Havuzda/);
    await page.waitForLoadState("networkidle");
  }
  await expect(slot(page, names.a)).toHaveAccessibleName(/Havuzda/);

  await page.goto("/havuz");
  await expect(page.getByText(names.a)).toBeVisible();
  await context.close();
});

test("Dükkana gelecek müşteriyi Huni'ye taşır", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await loginOk(page, owners.b!);

  await slot(page, names.b).click();
  await page.getByRole("button", { name: /Dükkana gelecek/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ne zaman gelecek?" });
  await expect(dialog).toBeVisible();
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/bugun");
  await dialog.getByRole("button", { name: "Belli değil, uğrayacak" }).click();
  await dialog.getByRole("button", { name: "Kaydet" }).click();
  await saved;
  await expect(slot(page, names.b)).toHaveAccessibleName(/Tamamlandı/);
  await page.waitForLoadState("networkidle");

  await page.goto("/huni");
  await expect(page.getByText(names.b)).toBeVisible();
  await context.close();
});

test("Sonra ara geçmiş tarihi kaydetmez", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  await loginOk(page, owners.c!);

  await slot(page, names.c).click();
  await page.getByRole("button", { name: /Sonra ara/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ne zaman aransın?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Tarih ve saat").fill("2020-01-01T10:00");
  await dialog.getByRole("button", { name: "Kaydet" }).click();

  // Tarayıcı min doğrulaması ya da uygulama hata mesajı: ikisinde de diyalog açık kalır, kayıt oluşmaz
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Kaydedildi")).toHaveCount(0);
  await expect(slot(page, names.c)).toHaveAccessibleName(/Bekliyor/);

  // Vazgeç: kayıt oluşmaz, müşteri bekleyenlerde kalır (mobil ve filtre testleri ona dayanır)
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  await expect(slot(page, names.c)).toHaveAccessibleName(/Bekliyor/);
  await context.close();
});

test("Sonra ara ile yarına ertelenen müşteri bugünün sayısından düşer, Ertelendi grubunda görünür", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  await loginOk(page, owners.d!);

  const pills = page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button");
  const before = await pills.count();
  const title = page.getByRole("heading", { level: 1 });
  const left = Number(((await title.locator("em").innerText()) || "0").replace(/\D/g, ""));
  await expect(page.getByRole("button", { name: /^Ertelendi/ })).toHaveCount(0);

  await slot(page, names.d).click();
  await page.getByRole("button", { name: /Sonra ara/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ne zaman aransın?" });
  await dialog.getByRole("button", { name: "Yarın 10:00" }).click();
  await dialog.getByRole("button", { name: "Kaydet" }).click();
  await expect(dialog).toBeHidden();

  // Sayı ve slot 1 azalır, müşteri bugünün listesinden çıkar
  await expect(slot(page, names.d)).toHaveCount(0);
  await expect(pills).toHaveCount(before - 1);
  if (left > 1) await expect(title.locator("em")).toHaveText(String(left - 1));

  // Ertelendi grubu varsayılan kapalı, sayısıyla görünür; açınca geri arama zamanı yazar
  const group = page.getByRole("button", { name: /^Ertelendi/ });
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await expect(group).toContainText("1");
  await expect(page.getByText(names.d)).toHaveCount(0);
  await group.click();
  const row = page.locator("#ertelendi-liste", { hasText: names.d });
  await expect(row).toContainText(/Geri arama yarın 10:00/);

  // Yenilemede de aynı: sunucu verisinden gruba düşer
  await page.reload();
  await expect(pills).toHaveCount(before - 1);
  await expect(page.getByRole("button", { name: /^Ertelendi/ })).toBeVisible();
  await context.close();
});

test("mobil 375px: Ara butonu görünür, menü örtmez, yatay taşma yok", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true });
  await loginOk(page, owners.c!);

  await slot(page, names.c).click();
  const ara = page.getByRole("main").getByRole("link", { name: "Ara", exact: true });
  await ara.scrollIntoViewIfNeeded();
  await expect(ara).toBeVisible();

  const box = (await ara.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Ana menü" }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1); // menünün üstünde kalır
  // Düğmenin merkezindeki öğe düğmenin kendisi (menü örtmüyor)
  const topIsAra = await ara.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });
  expect(topIsAra).toBe(true);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("durum filtresi hapları ve listeyi süzer, Daralt erişilir", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  await loginOk(page, "yonetici");

  const filters = page.getByRole("group", { name: "Duruma göre filtrele" });
  const pills = page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button");
  const total = await pills.count();
  const sizeOf = () => pills.first().evaluate((el) => `${el.clientWidth}x${el.clientHeight}`);
  const size = await sizeOf();

  // Bekleyen müşteri her zaman vardır (c); tekrar ara çipi seçilince bekleyenler soluklaşır
  const wait = filters.getByRole("button", { name: /^Bekliyor \d+$/ });
  await expect(wait).toBeEnabled();
  const n = Number((await wait.innerText()).replace(/\D/g, ""));
  await wait.click();
  await expect(wait).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-dim="true"]')).toHaveCount(total - n);
  expect(await sizeOf()).toBe(size);
  expect(await pills.count()).toBe(total);

  // Aynı çipe tekrar basınca Hepsi'ne döner
  await wait.click();
  await expect(filters.getByRole("button", { name: /^Hepsi/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-dim="true"]')).toHaveCount(0);

  // Sıra listesi genişleyince başlıktaki Daralt aşağı kaydırılmışken de erişilir
  const card = page.locator("section.card", { has: page.getByRole("heading", { name: /Bugünün sırası/ }) });
  await card.getByRole("button", { name: /^Tümünü göster/ }).first().click();
  const daralt = card.getByRole("button", { name: "Daralt", exact: true });
  await expect(daralt).toBeVisible();
  // Liste kart içinde kayar; sayfa kaymaz, Daralt yerinde kalır
  const lb = (await page.getByTestId("queue-list").boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.wheel(0, 600);
  await expect(daralt).toBeInViewport();
  await daralt.click();
  await expect(card.getByRole("button", { name: /^Tümünü göster/ }).first()).toBeVisible();
  await context.close();
});

test("Daralt ve Genişlet: basılan düğme ekranda yerinde kalır", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true });
  await loginOk(page, "yonetici");

  const card = page.locator("section.card", { has: page.getByRole("heading", { name: /Bugünün sırası/ }) });
  await card.getByRole("button", { name: /^Tümünü göster/ }).first().click();
  const daralt = card.getByRole("button", { name: "Daralt", exact: true });
  await expect(daralt).toBeVisible();

  // Kartın başına in: Daralt üst menünün altında
  await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80));
  await expect(daralt).toBeInViewport();
  const top = async () => Math.round((await daralt.boundingBox())!.y);
  const before = await top();
  await daralt.click();
  const genislet = card.getByRole("button", { name: /^Tümünü göster/ }).first();
  await expect(genislet).toBeVisible();
  await page.waitForTimeout(500); // smooth kaydırma olsaydı bu sürede kayardı
  expect(Math.abs((await genislet.evaluate((el) => Math.round(el.getBoundingClientRect().top))) - before)).toBeLessThanOrEqual(1);
  await context.close();
});

test("vakti gelmiş geri arama hatırlatma kartı görünür, Kapat ile tek satıra küçülür", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true });
  // Vakti gelmiş tekrar-ara müşterisi: yanıt sahte kurgusal veriyle değiştirilir (diğer sorgular gerçek)
  const fake = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i + 1}`,
      full_name: `Kurgu Kisi ${i + 1}`,
      phone: "05000000000",
      next_call_at: new Date(Date.now() - 60_000 * (i + 1)).toISOString(),
    }));
  const fixture = JSON.stringify(fake(5));
  await page.route(/\/rest\/v1\/customers\?.*call_status=eq\.retry/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: fixture }),
  );
  await loginOk(page, owners.c!);

  const status = page.getByRole("status").filter({ hasText: "Geri arama vakti" });
  await expect(status).toBeVisible();
  await expect(status.getByRole("link", { name: "Ara" })).toHaveCount(3);
  await expect(status).toContainText("ve 2 kişi daha");
  await status.getByRole("button", { name: "Kapat", exact: true }).click();
  // Liste dolu: kart kapanmaz, tek satıra küçülür (ilk kişi + kalan sayı, tek Ara)
  await expect(status).toBeVisible();
  await expect(status).toContainText("Kurgu Kisi 1 ve 4 kişi daha");
  await expect(status.getByRole("link", { name: "Kurgu Kisi 1 ara" })).toHaveCount(1);

  // Küçük hal yenilemede korunur
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(status).toContainText("ve 4 kişi daha");
  await expect(status.getByRole("button", { name: "Kapat", exact: true })).toHaveCount(0);

  // Genişlet: tam kart geri gelir
  await status.getByRole("button", { name: "Hatırlatmayı genişlet" }).click();
  await expect(status.getByRole("link", { name: "Ara" })).toHaveCount(3);

  // Aramalar bitince (liste boş) kart tamamen kaybolur
  await page.unroute(/\/rest\/v1\/customers\?.*call_status=eq\.retry/);
  await page.route(/\/rest\/v1\/customers\?.*call_status=eq\.retry/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Geri arama vakti")).toHaveCount(0);
  await context.close();
});

for (const width of [1440, 1280]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`yönetici ${width}px ${scheme}: Tümünü göster kartı uzatmaz, alt kartlar üst sütunlarla hizalı`, async ({ browser }) => {
      const { context, page } = await freshPage(browser, { viewport: { width, height: 900 }, colorScheme: scheme });
      await loginOk(page, "yonetici");
      const card = page.locator("section.card", { has: page.getByRole("heading", { name: /Bugünün sırası/ }) });
      const list = page.getByTestId("queue-list");
      const box = (loc: ReturnType<Page["locator"]>) =>
        loc.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, height: r.height };
        });
      const before = await box(card);
      await card.getByRole("button", { name: /^Tümünü göster/ }).first().click();
      await expect(card.getByRole("button", { name: "Daralt", exact: true })).toBeVisible();
      const after = await box(card);
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
      const m = await list.evaluate((el) => {
        const before = el.scrollTop;
        el.scrollTop = 40;
        const moved = el.scrollTop > before;
        return { scrollable: el.scrollHeight > el.clientHeight, moved };
      });
      expect(m.scrollable).toBe(true);
      expect(m.moved).toBe(true);

      const team = await box(page.getByTestId("team-grid").locator("xpath=ancestor::*[contains(@class,'card')][1]"));
      const dist = await box(page.locator("section.card, div.card", { has: page.getByRole("heading", { name: "Dağıtım", exact: true }) }).last());
      const pool = await box(page.locator("section.card, div.card", { has: page.getByRole("heading", { name: /^Havuz/ }) }).last());
      expect(Math.abs(team.left - after.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(team.right - after.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(dist.left - pool.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(dist.right - pool.right)).toBeLessThanOrEqual(1);
      await context.close();
    });
  }
}

test("mobil 375px: sıra listesi kart içinde kayar", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true });
  await loginOk(page, "yonetici");
  const card = page.locator("section.card", { has: page.getByRole("heading", { name: /Bugünün sırası/ }) });
  await card.getByRole("button", { name: /^Tümünü göster/ }).first().click();
  const m = await page.getByTestId("queue-list").evaluate((el) => {
    el.scrollTop = 40;
    return { scrollable: el.scrollHeight > el.clientHeight, moved: el.scrollTop > 0, h: el.clientHeight };
  });
  expect(m.scrollable).toBe(true);
  expect(m.moved).toBe(true);
  expect(m.h).toBeLessThanOrEqual(812 * 0.6 + 1);
  await context.close();
});
