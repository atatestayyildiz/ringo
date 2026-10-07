import { expect, test, type Browser, type Page } from "@playwright/test";
import { AGENTS, deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag, type UserKey } from "./helpers";

// Üç kurgusal müşteri dağıtılır; yönetici bir çalışanın açık işlerini aktarır, sonra listeden iki müşteriyi seçip aktarır.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const names = { a: `Ayla ${tag}a`, b: `Bora ${tag}b`, c: `Ceren ${tag}c` };
const owners: Partial<Record<keyof typeof names, UserKey>> = {};
const FIRST: Record<UserKey, RegExp> = { yonetici: /Yönetici/, elif: /Elif/, ayse: /Ayşe/, can: /Can/ };

const slot = (page: Page, name: string) =>
  page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button", { name: new RegExp(name) });

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

test("yönetici bir çalışanın açık işlerini diğerine aktarır, alıcının Bugün listesinde görünür", async ({ browser }) => {
  const source = owners.a!;
  const target = AGENTS.find((x) => x !== source)!;
  const moved = (["a", "b", "c"] as const).filter((k) => owners[k] === source).map((k) => names[k]);

  const { context, page } = await freshPage(browser);
  await loginOk(page, "yonetici");
  await page.goto("/yonetim");
  await page.getByRole("button", { name: new RegExp(`${FIRST[source].source}.* işlerini aktar`) }).click();
  const dialog = page.getByRole("dialog", { name: "İşlerini aktar" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Kime aktarılsın" }).click();
  await page.getByRole("listbox").getByRole("option", { name: FIRST[target] }).click();
  await dialog.getByRole("button", { name: "Aktar", exact: true }).click();
  await expect(page.getByText(/\d+ müşteri aktarıldı/)).toBeVisible();
  await context.close();

  const t = await freshPage(browser);
  await loginOk(t.page, target);
  for (const n of moved) await expect(slot(t.page, n)).toBeVisible();
  await t.context.close();

  const s = await freshPage(browser);
  await loginOk(s.page, source);
  for (const n of moved) await expect(slot(s.page, n)).toHaveCount(0);
  await s.context.close();
});

test("yönetici listeden iki müşteriyi seçip aktarır", async ({ browser }) => {
  const target: UserKey = "can";
  const { context, page } = await freshPage(browser);
  await loginOk(page, "yonetici");
  await page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
  const list = page.getByRole("list", { name: /Müşteri listesi/ });
  await expect(list.getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: "Seç", exact: true }).click();
  await page.getByRole("checkbox", { name: `${names.a} seç` }).check();
  await page.getByRole("checkbox", { name: `${names.b} seç` }).check();
  const bar = page.getByRole("region", { name: "Seçim işlemleri" });
  await expect(bar.getByText("2 seçili")).toBeVisible();
  await bar.getByRole("button", { name: "Aktar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Müşterileri aktar" });
  await dialog.getByRole("combobox", { name: "Kime aktarılsın" }).click();
  await page.getByRole("listbox").getByRole("option", { name: FIRST[target] }).click();
  await dialog.getByRole("button", { name: "Aktar", exact: true }).click();
  await expect(page.getByText("2 müşteri aktarıldı")).toBeVisible();
  await expect(bar).toHaveCount(0);
  await context.close();

  const t = await freshPage(browser);
  await loginOk(t.page, target);
  await expect(slot(t.page, names.a)).toBeVisible();
  await expect(slot(t.page, names.b)).toBeVisible();
  await t.context.close();
});

test("tümünü seç görünen sayfayı seçer; yetkisiz çalışan seçim kutusu görmez; mobilde çalışır", async ({ browser }) => {
  const m = await freshPage(browser, { viewport: { width: 375, height: 812 } });
  await loginOk(m.page, "yonetici");
  await m.page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
  await m.page.getByRole("button", { name: "Seç", exact: true }).click();
  await m.page.getByRole("checkbox", { name: /Sayfadakilerin tümünü seç/ }).check();
  const bar = m.page.getByRole("region", { name: "Seçim işlemleri" });
  await expect(bar.getByText("3 seçili")).toBeVisible();
  await expect(bar.getByRole("button", { name: "Aktar", exact: true })).toBeInViewport();
  await bar.getByRole("button", { name: "Temizle" }).click();
  await expect(bar).toHaveCount(0);
  await m.context.close();

  const a = await freshPage(browser);
  await loginOk(a.page, "ayse");
  await a.page.goto("/musteriler");
  await expect(a.page.getByRole("checkbox")).toHaveCount(0);
  await a.context.close();
});
