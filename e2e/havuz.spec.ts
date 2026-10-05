import { expect, test, type Page } from "@playwright/test";
import { deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

// Ortak havuz: Elif'in havuza düşen müşterisini Ayşe görür (telefon yok) ve "Kendime al" ile Bugün listesine alır.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const name = `Havva ${tag}h`;
const phone = uniquePhone();

const slot = (page: Page, n: string) =>
  page.getByRole("group", { name: "Bugünün listesi" }).getByRole("button", { name: new RegExp(n) });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    const res = await importCsv(page, Buffer.from(["Ad Soyad;Telefon", `${name};${phone}`].join("\n"), "utf-8"));
    expect(res.inserted).toBe(1);
    await page.goto("/bugun");
    await page.getByRole("button", { name: "Dağıt" }).click();
    await expect(page.getByText(/müşteri dağıtıldı|Dağıtılacak yeni müşteri yok/)).toBeVisible();

    // Müşteri kimde olursa olsun Elif'e aktarılır (bugünkü ataması da taşınır)
    await page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
    await page.getByRole("checkbox", { name: `${name} seç` }).check();
    const bar = page.getByRole("region", { name: "Seçim işlemleri" });
    await bar.getByRole("button", { name: "Aktar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Müşterileri aktar" });
    await dialog.getByRole("combobox", { name: "Kime aktarılsın" }).click();
    await page.getByRole("listbox").getByRole("option", { name: /Elif/ }).click();
    await dialog.getByRole("button", { name: "Aktar", exact: true }).click();
    await expect(page.getByText("1 müşteri aktarıldı")).toBeVisible();
  } finally {
    await context.close();
  }

  // Elif 3 kez Açmadı: müşteri havuza düşer
  const e = await freshPage(browser);
  try {
    await loginOk(e.page, "elif");
    for (let i = 0; i < 10; i++) {
      await slot(e.page, name).click();
      const label = (await slot(e.page, name).getAttribute("aria-label")) ?? "";
      if (/Havuzda/.test(label)) break;
      const done = e.page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/bugun");
      await e.page.getByRole("button", { name: /Açmadı/ }).click();
      await done;
      await expect(slot(e.page, name)).toHaveAccessibleName(/Tekrar ara|Havuzda/);
      await e.page.waitForLoadState("networkidle");
    }
    await expect(slot(e.page, name)).toHaveAccessibleName(/Havuzda/);
  } finally {
    await e.context.close();
  }
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

test("Bugün'deki havuz kartı ortak: Ayşe, Elif'in havuz müşterisi dahil kiracının tüm havuzunu sayar", async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "ayse");
    const count = Number(await page.getByTestId("pool-count").innerText());
    await page.goto("/havuz");
    const rows = page.getByTestId("pool-row");
    await expect(rows.filter({ hasText: name })).toBeVisible();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await rows.count()).toBe(count);
  } finally {
    await context.close();
  }
});

test("Ayşe, Elif'in havuzdaki müşterisini telefonsuz görür ve Kendime al ile Bugün listesine alır", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 375, height: 812 } });
  await loginOk(page, "ayse");
  await expect(slot(page, name)).toHaveCount(0);

  await page.goto("/havuz");
  const row = page.getByTestId("pool-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Son: Elif");
  const text = await row.innerText();
  expect(text).not.toMatch(/\d{3}/); // telefon numarası yok (tarih ve sayaçlar en çok 2 hane)
  expect(await page.content()).not.toContain(phone.slice(1));

  const done = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/havuz");
  await row.getByRole("button", { name: `${name} kendime al` }).click();
  const resp = await done;
  expect(resp.ok()).toBe(true);
  const notice = page.getByRole("status").filter({ hasText: `${name} listene eklendi` });
  await expect(notice).toBeVisible();
  await expect(row).toHaveCount(0);

  await notice.getByRole("link", { name: "Bugün'e git" }).click();
  await expect(page).toHaveURL(/\/bugun/);
  await expect(slot(page, name)).toBeVisible();
  await context.close();

  // Elif artık müşteriyi havuzda görmez; ikinci alma mümkün değil
  const e = await freshPage(browser);
  await loginOk(e.page, "elif");
  await e.page.goto("/havuz");
  await expect(e.page.getByTestId("pool-row").filter({ hasText: name })).toHaveCount(0);
  await e.context.close();
});
