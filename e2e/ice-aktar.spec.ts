import { expect, test } from "@playwright/test";
import { deleteByTag, encodeWindows1254, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

test("windows-1254 CSV: geçerli, mükerrer ve geçersiz satırlar doğru sayılır", async ({ page }) => {
  const tag = uniqueTag();
  const p1 = uniquePhone();
  const p2 = uniquePhone();
  const csv = [
    "Ad Soyad;Telefon;Operatör",
    `Çağrı Şükrü ${tag};${p1};Türk Telekom`,
    `Ümit Ğöl ${tag};${p2};Vodafone`,
    `Çağrı Şükrü ${tag} Tekrar;${p1};Turkcell`, // aynı dosyada mükerrer
    `;${uniquePhone()};Turkcell`, // ad boş
    `Hatalı Numara ${tag};12345;Turkcell`, // telefon geçersiz
  ].join("\r\n");

  await loginOk(page, "yonetici");
  try {
    const first = await importCsv(page, encodeWindows1254(csv));
    expect(first).toEqual({ inserted: 2, duplicates: 1, invalid: 2 });
    await expect(page.getByText("Ad soyad boş")).toBeVisible();
    await expect(page.getByText("Telefon numarası geçersiz")).toBeVisible();

    // Türkçe karakterler bozulmadan kaydedilmiş olmalı
    await page.goto(`/musteriler?q=${tag}`);
    await expect(page.getByText(`Çağrı Şükrü ${tag}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Ümit Ğöl ${tag}`, { exact: true })).toBeVisible();

    // Aynı dosya tekrar: hepsi mükerrer, yeni kayıt yok
    const second = await importCsv(page, encodeWindows1254(csv));
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(3);
    expect(second.invalid).toBe(2);
  } finally {
    await deleteByTag(page, tag);
  }
  await page.goto(`/musteriler?q=${tag}`);
  await expect(page.getByRole("list", { name: /Müşteri listesi/ })).toHaveCount(0);
});
