import { expect, test, type Page } from "@playwright/test";
import { deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

// Dağıtım modları: yönetici Serbest havuz seçer, satışçı "Sıradaki müşteriyi al" ile müşteri alır ve
// sınıra gelince düğme kapanır; Elle dağıtımda Bugün'de "Dağıt" yerine "Müşterileri ata" görünür.
// Kiracı ayarı test sonunda otomatik eşit dağıtıma ve sınır 3'e döner.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const name = `Sena ${tag}s`;

function postDone(page: Page, path: string) {
  return page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === path);
}

async function saveMode(page: Page, label: string, claimLimit?: number) {
  await page.goto("/ayarlar");
  await page.getByRole("combobox", { name: "Dağıtım yöntemi" }).click();
  await page.getByRole("listbox").getByRole("option", { name: label }).click();
  if (claimLimit !== undefined) {
    await page.getByLabel("Aynı anda en fazla açık müşteri").fill(String(claimLimit));
  }
  const done = postDone(page, "/ayarlar");
  await page.getByRole("button", { name: "Kaydet" }).click();
  expect((await done).ok()).toBe(true);
  await expect(page.getByText("Kurallar kaydedildi.")).toBeVisible();
}

async function restore(page: Page) {
  // Önce serbest havuzda sınırı 3'e çek, sonra otomatik eşit dağıtıma dön
  await saveMode(page, "Serbest havuz", 3);
  await saveMode(page, "Otomatik eşit dağıtım");
}

test("serbest havuz: satışçı sıradakini alır, sınırda düğme kapanır", async ({ browser }) => {
  test.setTimeout(180_000);
  const m = await freshPage(browser);
  await loginOk(m.page, "yonetici");
  try {
    await saveMode(m.page, "Serbest havuz", 3);
    await expect(m.page.getByTestId("mode-summary")).toContainText("Sıradaki müşteriyi al");
    // Kuyrukta en az bir müşteri olsun (sahipsiz bekleyen)
    const res = await importCsv(m.page, Buffer.from(["Ad Soyad;Telefon", `${name};${uniquePhone()}`].join("\n"), "utf-8"));
    expect(res.inserted).toBe(1);

    // Yönetici Bugün'de Dağıt görmez
    await m.page.goto("/bugun");
    await expect(m.page.getByRole("button", { name: "Dağıt", exact: true })).toHaveCount(0);
    await expect(m.page.getByText(/Serbest havuz açık/)).toBeVisible();

    // Satışçının açık müşteri sayısı + 1 = sınır: bir müşteri alabilir, sonra sınırdadır
    const a = await freshPage(browser);
    try {
      await loginOk(a.page, "can");
      const card = a.page.getByTestId("claim-card");
      await expect(card).toBeVisible();
      const open = Number(/(\d+) \/ \d+/.exec(await card.innerText())?.[1] ?? /Listende (\d+)/.exec(await card.innerText())?.[1]);
      expect(Number.isInteger(open)).toBe(true);
      test.skip(open + 1 > 50, "Satışçının açık müşterisi sınır aralığını aşıyor");

      await saveMode(m.page, "Serbest havuz", open + 1);

      await a.page.reload();
      const btn = card.getByRole("button", { name: "Sıradaki müşteriyi al" });
      await expect(btn).toBeEnabled();
      const done = postDone(a.page, "/bugun");
      await btn.click();
      expect((await done).ok()).toBe(true);
      await expect(a.page.getByText(/listene eklendi/)).toBeVisible();
      await expect(a.page).toHaveURL(/\/bugun\?m=/);
      await expect(card).toContainText(`Listende ${open + 1} açık müşteri var, sınır ${open + 1}.`);
      await expect(btn).toBeDisabled();
      // Alınan müşteri odak kartında
      const claimed = decodeURIComponent(new URL(a.page.url()).searchParams.get("m") ?? "");
      expect(claimed).toMatch(/^[0-9a-f-]{36}$/);
      await expect(a.page.getByRole("group", { name: "Bugünün listesi" }).locator('[aria-current="true"]')).toHaveCount(1);
    } finally {
      await a.context.close();
    }
  } finally {
    await restore(m.page);
    await deleteByTag(m.page, tag);
    await m.context.close();
  }
});

test("elle dağıtım: Bugün'de Dağıt yerine Müşterileri ata bağlantısı", async ({ browser }) => {
  const m = await freshPage(browser);
  await loginOk(m.page, "yonetici");
  try {
    await saveMode(m.page, "Elle dağıtım");
    await expect(m.page.getByTestId("mode-summary")).toContainText("Yönetici Müşteriler ekranından");
    await expect(m.page.getByLabel("Aynı anda en fazla açık müşteri")).toHaveCount(0);
    await m.page.goto("/bugun");
    await expect(m.page.getByRole("button", { name: "Dağıt", exact: true })).toHaveCount(0);
    const link = m.page.getByRole("link", { name: "Müşterileri ata" });
    await expect(link).toHaveAttribute("href", "/musteriler?atanan=yok");

    // Satışçıda serbest havuz kartı yok
    const a = await freshPage(browser);
    try {
      await loginOk(a.page, "can");
      await expect(a.page.getByTestId("claim-card")).toHaveCount(0);
    } finally {
      await a.context.close();
    }
  } finally {
    await restore(m.page);
    await m.context.close();
  }
});
