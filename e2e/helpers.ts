import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PASSWORD = "Demo1234!";
export const USERS = {
  yonetici: "yonetici@demo.test",
  elif: "elif@demo.test",
  ayse: "ayse@demo.test",
  can: "can@demo.test",
} as const;
export type UserKey = keyof typeof USERS;
export const AGENTS: UserKey[] = ["elif", "ayse", "can"];

export async function login(page: Page, who: UserKey, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(USERS[who]);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

export async function loginOk(page: Page, who: UserKey) {
  await login(page, who);
  await expect(page).toHaveURL(/\/bugun/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Çıkış yap" }).click();
  await expect(page).toHaveURL(/\/giris/);
}

/** Yeni, oturumsuz bağlam + sayfa. */
export async function freshPage(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const context: BrowserContext = await browser.newContext(opts);
  const page = await context.newPage();
  return { context, page };
}

/** Her koşuda benzersiz, yalnız harf içeren etiket (arama ve temizlik için). */
export function uniqueTag(prefix = "Zt"): string {
  const letters = "abcdefghijklmnoprstuvyz";
  let s = "";
  for (let i = 0; i < 6; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return `${prefix}${s}`;
}

let phoneSeq = 0;
/** Kurgusal, benzersiz cep numarası: 05 + 9 hane. */
export function uniquePhone(): string {
  phoneSeq += 1;
  const base = Number(Date.now().toString().slice(-7)) * 100 + phoneSeq;
  return `05${String(base).padStart(9, "0")}`;
}

const TR_1254: Record<string, number> = {
  "ç": 0xe7, "Ç": 0xc7, "ğ": 0xf0, "Ğ": 0xd0, "ı": 0xfd, "İ": 0xdd,
  "ö": 0xf6, "Ö": 0xd6, "ş": 0xfe, "Ş": 0xde, "ü": 0xfc, "Ü": 0xdc,
};

/** Metni windows-1254 baytlarına çevirir (Excel'in Türkçe CSV çıktısı gibi). */
export function encodeWindows1254(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const mapped = TR_1254[ch];
    if (mapped !== undefined) out.push(mapped);
    else {
      const code = ch.charCodeAt(0);
      if (code > 0xff) throw new Error(`windows-1254 dışı karakter: ${ch}`);
      out.push(code);
    }
  }
  return Buffer.from(out);
}

export type ImportSummary = { inserted: number; duplicates: number; invalid: number };

/** Yöneticiyle (giriş yapılmış sayfa) CSV içe aktarır ve sonuç sayılarını döndürür. */
export async function importCsv(page: Page, csv: Buffer, name = "e2e.csv"): Promise<ImportSummary> {
  await page.goto("/musteriler/ice-aktar");
  await page.getByLabel("Dosya seç").setInputFiles({ name, mimeType: "text/csv", buffer: csv });
  await page.getByRole("button", { name: "Önizleme" }).click();
  await page.getByRole("button", { name: /müşteriyi içe aktar/ }).click();
  await expect(page.getByText("Eklendi", { exact: true })).toBeVisible();
  const num = async (label: string) => {
    const t = await page.locator(".mu-stat", { has: page.getByText(label, { exact: true }) }).locator("b").innerText();
    return Number(t);
  };
  return { inserted: await num("Eklendi"), duplicates: await num("Mükerrer"), invalid: await num("Geçersiz") };
}

/** Yöneticiyle (giriş yapılmış sayfa) etiketi içeren tüm müşterileri siler (delete_customer). */
export async function deleteByTag(page: Page, tag: string) {
  for (let guard = 0; guard < 20; guard++) {
    await page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
    await page.waitForLoadState("networkidle");
    const rows = page.getByRole("list", { name: /Müşteri listesi/ }).getByRole("button");
    if ((await rows.count()) === 0) return;
    await rows.first().click();
    await page.getByRole("button", { name: "Müşteriyi sil" }).click();
    await page.getByRole("button", { name: "Kalıcı olarak sil" }).click();
    await expect(page.getByRole("button", { name: "Kalıcı olarak sil" })).toBeHidden();
    await page.waitForLoadState("networkidle");
  }
}
