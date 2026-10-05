import { expect, test, type Browser, type Page } from "@playwright/test";
import { AGENTS, deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag, type UserKey } from "./helpers";

// İki kurgusal müşteri: A "yarın 14:00", B "belli değil, uğrayacak". Sonra Huni menüsünden B'nin zamanı değişir.
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 15_000 });

const tag = uniqueTag();
const names = { a: `Arda ${tag}a`, b: `Berk ${tag}b` };
const owners: Partial<Record<keyof typeof names, UserKey>> = {};

const slot = (page: Page, name: string) =>
  page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button", { name: new RegExp(name) });
const card = (page: Page, name: string) => page.getByTitle(name);

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

async function saveAppointment(browser: Browser, key: keyof typeof names, fill: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) {
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, owners[key]!);
    await slot(page, names[key]).click();
    await page.getByRole("button", { name: /Dükkana gelecek/ }).click();
    const dialog = page.getByRole("dialog", { name: "Ne zaman gelecek?" });
    await expect(dialog).toBeVisible();
    await fill(dialog);
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/bugun");
    await dialog.getByRole("button", { name: "Kaydet" }).click();
    await saved;
    await expect(slot(page, names[key])).toHaveAccessibleName(/Tamamlandı/);
    await page.waitForLoadState("networkidle");
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    const csv = ["Ad Soyad;Telefon", `${names.a};${uniquePhone()}`, `${names.b};${uniquePhone()}`].join("\n");
    expect((await importCsv(page, Buffer.from(csv, "utf-8"))).inserted).toBe(2);
    await page.goto("/bugun");
    await page.getByRole("button", { name: "Dağıt" }).click();
    await expect(page.getByText(/müşteri dağıtıldı|Dağıtılacak yeni müşteri yok/)).toBeVisible();
  } finally {
    await context.close();
  }
  for (const k of ["a", "b"] as const) owners[k] = await findOwner(browser, names[k]);
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

test("Bugün: yarın 14:00 ve belli değil randevuları Huni'de doğru görünür ve sıralanır", async ({ browser }) => {
  test.setTimeout(180_000);
  // Önce belli olmayan, sonra yarın 14:00 kaydedilir: sıralama kayıt sırasından bağımsız olmalı
  await saveAppointment(browser, "b", async (dialog) => {
    await dialog.getByRole("button", { name: "Belli değil, uğrayacak" }).click();
  });
  await saveAppointment(browser, "a", async (dialog) => {
    await dialog.getByRole("button", { name: "Yarın" }).click();
    await dialog.getByLabel("Saat (isteğe bağlı)").fill("14:00");
  });

  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    await loginOk(page, "yonetici");
    await page.goto("/huni");
    const col = page.getByRole("listitem", { name: "Dükkana gelecek" });
    await expect(card(page, names.a).getByText("Yarın 14:00")).toBeVisible();
    await expect(card(page, names.b).getByText("Belli değil")).toBeVisible();
    const ya = (await col.getByTitle(names.a).boundingBox())!.y;
    const yb = (await col.getByTitle(names.b).boundingBox())!.y;
    expect(ya).toBeLessThan(yb);
  } finally {
    await context.close();
  }
});

test("Huni menüsünden randevu zamanı değişir", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    await loginOk(page, "yonetici");
    await page.goto("/huni");
    await expect(card(page, names.b).getByText("Belli değil")).toBeVisible();
    await card(page, names.b).getByRole("combobox", { name: `${names.b} için aşamayı değiştir` }).click();
    await page.getByRole("listbox").getByRole("option", { name: "Randevu zamanını değiştir" }).click();
    const dialog = page.getByRole("dialog", { name: "Randevu zamanını değiştir" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Bugün" }).click();
    await dialog.getByLabel("Saat (isteğe bağlı)").fill("23:30");
    await dialog.getByRole("button", { name: "Kaydet" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, names.b).getByText("Bugün 23:30")).toBeVisible();
    // Bugün 23:30 yarın 14:00'dan önce: sıra tersine döner
    const col = page.getByRole("listitem", { name: "Dükkana gelecek" });
    const ya = (await col.getByTitle(names.a).boundingBox())!.y;
    const yb = (await col.getByTitle(names.b).boundingBox())!.y;
    expect(yb).toBeLessThan(ya);
  } finally {
    await context.close();
  }
});
