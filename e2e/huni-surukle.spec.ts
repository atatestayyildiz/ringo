import { expect, test, type Page } from "@playwright/test";
import { deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

// Kurgusal bir müşteri huniye "Dükkana gelecek" olarak alınır; kart sütunlar arasında sürüklenir.
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 15_000 });

const tag = uniqueTag();
const name = `Sude ${tag}`;

const col = (page: Page, label: string) => page.getByRole("listitem", { name: label });
const card = (page: Page) => page.getByTitle(name);

async function setup(page: Page) {
  await page.goto(`/musteriler?q=${encodeURIComponent(tag)}`);
  await page.getByRole("list", { name: /Müşteri listesi/ }).getByRole("button").first().click();
  await page.getByRole("combobox", { name: "Aşama", exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Dükkana gelecek" }).click();
  await page.getByRole("button", { name: "Aşamayı kaydet" }).click();
  await expect(page.getByRole("status").getByText("Aşama: Dükkana gelecek")).toBeVisible();
}

async function mouseDrag(page: Page, to: string) {
  const from = (await card(page).boundingBox())!;
  const target = (await col(page, to).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 24, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 12 });
  await page.mouse.up();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    const res = await importCsv(page, Buffer.from(`Ad Soyad;Telefon\n${name};${uniquePhone()}`, "utf-8"));
    expect(res.inserted).toBe(1);
    await setup(page);
  } finally {
    await context.close();
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

test("masaüstü: kart fareyle başka sütuna sürüklenir, yenileyince orada; aynı sütuna bırakma işlem yapmaz", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  await loginOk(page, "yonetici");
  await page.goto("/huni");
  await expect(col(page, "Dükkana gelecek").getByTitle(name)).toBeVisible();

  // aynı sütuna bırakma
  const own = (await col(page, "Dükkana gelecek").boundingBox())!;
  const c = (await card(page).boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + 12);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 10, c.y + 30, { steps: 4 });
  await page.mouse.move(own.x + own.width / 2, own.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(col(page, "Dükkana gelecek").getByTitle(name)).toBeVisible();

  await mouseDrag(page, "Geldi");
  await expect(col(page, "Geldi").getByTitle(name)).toBeVisible();
  await page.reload();
  await expect(col(page, "Geldi").getByTitle(name)).toBeVisible();
  await context.close();
});

test("masaüstü: menüyle taşıma hâlâ çalışır", async ({ browser }) => {
  const { context, page } = await freshPage(browser, { viewport: { width: 1280, height: 800 } });
  await loginOk(page, "yonetici");
  await page.goto("/huni");
  await page.getByRole("combobox", { name: `${name} için aşamayı değiştir` }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Başvuru" }).click();
  await expect(col(page, "Başvuru").getByTitle(name)).toBeVisible();
  await page.reload();
  await expect(col(page, "Başvuru").getByTitle(name)).toBeVisible();
  await context.close();
});

test("mobil 375px: basılı tutunca dokunmatik sürükleme çalışır", async ({ browser }) => {
  const { context, page } = await freshPage(browser, {
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await loginOk(page, "yonetici");
  await page.goto("/huni");
  await expect(col(page, "Başvuru").getByTitle(name)).toBeVisible();

  const from = (await card(page).boundingBox())!;
  const target = (await col(page, "Onaylandı").boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y }];
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(sx, sy) });
  await page.waitForTimeout(400);
  const tx = target.x + target.width / 2;
  const ty = target.y + 100;
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pt(sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByText(new RegExp(`${name}: `))).toBeVisible();
  await page.reload();
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: card(page) })).toHaveAccessibleName("Onaylandı");
  await context.close();
});
