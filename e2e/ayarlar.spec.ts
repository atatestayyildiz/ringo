import { expect, test } from "@playwright/test";
import { loginOk } from "./helpers";

test("kural değişince kayıtlı özet değişir ve geri alınır", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");

  const field = page.getByLabel("Havuzda bekleme (gün)");
  const saved = page.getByTestId("rules-saved");
  const original = await field.inputValue();
  const before = (await saved.innerText()).trim();
  const changed = String(Number(original) === 9 ? 8 : 9);

  const save = async (value: string) => {
    await field.fill(value);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Kurallar kaydedildi.")).toBeVisible();
  };

  try {
    await save(changed);
    await expect(saved).toContainText(`${changed} gün sonra`);
    await expect(saved).not.toHaveText(before);
  } finally {
    await field.fill(original);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(saved).toHaveText(before);
  }
});

test("logo adresi yalnız https kabul edilir", async ({ page }) => {
  await loginOk(page, "yonetici");
  await page.goto("/ayarlar");
  await page.getByText("Marka", { exact: true }).click();
  await page.getByPlaceholder("https://").fill("http://example.test/logo.png");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Logo adresi https:// ile başlayan geçerli bir bağlantı olmalı.")).toBeVisible();
});
