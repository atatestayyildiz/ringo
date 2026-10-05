import { expect, test } from "@playwright/test";
import { deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

test.describe.configure({ mode: "serial" });

const tag = uniqueTag();

test.afterAll(async ({ browser }) => {
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    await deleteByTag(page, tag);
  } finally {
    await context.close();
  }
});

test("yönetici iki test müşterisini seçip toplu siler", async ({ page }) => {
  await loginOk(page, "yonetici");
  const a = `Silinecek ${tag}a`;
  const b = `Silinecek ${tag}b`;
  const csv = ["Ad Soyad;Telefon", `${a};${uniquePhone()}`, `${b};${uniquePhone()}`].join("\n");
  const res = await importCsv(page, Buffer.from(csv, "utf-8"));
  expect(res.inserted).toBe(2);

  await page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
  const list = page.getByRole("list", { name: /Müşteri listesi/ });
  await expect(list.getByRole("button")).toHaveCount(2);
  await page.getByRole("checkbox", { name: `${a} seç` }).check();
  await page.getByRole("checkbox", { name: `${b} seç` }).check();

  const bar = page.getByRole("region", { name: "Seçim işlemleri" });
  await expect(bar.getByText("2 seçili")).toBeVisible();
  await bar.getByRole("button", { name: "Sil", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Müşteriler silinsin mi?" });
  await expect(dialog.getByText("2 müşteri kalıcı olarak silinecek. Bu işlem geri alınamaz.")).toBeVisible();
  await dialog.getByRole("button", { name: "Kalıcı olarak sil" }).click();

  await expect(page.getByText("2 müşteri silindi")).toBeVisible();
  await expect(page.getByText("Aramayla eşleşen müşteri yok")).toBeVisible();
});

test("yetkisiz çalışanda seçim ve Sil görünmez", async ({ page }) => {
  await loginOk(page, "ayse");
  await page.goto("/musteriler");
  await expect(page.getByRole("heading", { name: "Müşteriler", level: 1 })).toBeVisible();
  await expect(page.getByText(/Sayfadakilerin tümünü seç/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Seçim işlemleri" })).toHaveCount(0);
});

test("Ayarlar'da ekleme ve silme tek anahtardır", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await page.getByText("Ekip", { exact: true }).click();

  const card = page.locator('[data-member="ayse@demo.test"]');
  await card.getByRole("button", { name: "Yetkiler" }).click();
  await expect(card.getByText("Müşteri ekler, Excel içe aktarır ve siler.")).toBeVisible();
  await expect(card.getByText("Müşteri silebilsin")).toHaveCount(0);

  const sw = card.getByRole("switch", { name: /Müşteri eklesin \/ silsin/ });
  const wasOn = (await sw.getAttribute("aria-checked")) === "true" || (await sw.isChecked());
  expect(wasOn).toBe(false);
  try {
    await sw.click({ force: true });
    await expect(sw).toBeChecked();
    await page.reload();
    await page.getByText("Ekip", { exact: true }).click();
    const card2 = page.locator('[data-member="ayse@demo.test"]');
    await card2.getByRole("button", { name: "Yetkiler" }).click();
    await expect(card2.getByRole("switch", { name: /Müşteri eklesin \/ silsin/ })).toBeChecked();
  } finally {
    const card3 = page.locator('[data-member="ayse@demo.test"]');
    if ((await card3.getByRole("switch", { name: /Müşteri eklesin \/ silsin/ }).count()) === 0) {
      await card3.getByRole("button", { name: "Yetkiler" }).click();
    }
    const s3 = card3.getByRole("switch", { name: /Müşteri eklesin \/ silsin/ });
    if (await s3.isChecked()) {
      await s3.click({ force: true });
      await expect(s3).not.toBeChecked();
    }
  }
});
