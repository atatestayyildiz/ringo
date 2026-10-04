import { expect, test, type Browser, type Page } from "@playwright/test";
import { AGENTS, deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag, type UserKey } from "./helpers";

// Üç kurgusal müşteri: A havuza düşer, B huniye girer, C geri arama ve mobil testleri için bekler.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const names = { a: `Ayla ${tag}a`, b: `Bora ${tag}b`, c: `Ceren ${tag}c` };
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
    ].join("\n");
    const res = await importCsv(page, Buffer.from(csv, "utf-8"));
    expect(res.inserted).toBe(3);

    await page.goto("/bugun");
    await page.getByRole("button", { name: "Dağıt" }).click();
    await expect(page.getByText(/müşteri dağıtıldı|Dağıtılacak yeni müşteri yok/)).toBeVisible();
  } finally {
    await context.close();
  }
  for (const k of ["a", "b", "c"] as const) owners[k] = await findOwner(browser, names[k]);
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
    await page.getByRole("button", { name: /Açmadı/ }).click();
    // sunucu cevabı gelene kadar bekle: düğmeler tekrar açılır
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

  // Gelecek tarih kabul edilir
  await dialog.getByRole("button", { name: "Yarın 10:00" }).click();
  await dialog.getByRole("button", { name: "Kaydet" }).click();
  await expect(dialog).toBeHidden();
  await expect(slot(page, names.c)).toHaveAccessibleName(/Tekrar ara/);
  await context.close();
});

test("mobil 375px: Ara butonu görünür, menü örtmez, yatay taşma yok", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 }, isMobile: true });
  await loginOk(page, owners.c!);

  await slot(page, names.c).click();
  const ara = page.getByRole("link", { name: "Ara", exact: true });
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
