import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, USERS } from "./helpers";

// Açılış sahnesi + kapı: girişten sonra kapı katmanı görünür, panel arkada yüklenir, kapı kaldırılır.
// FPS kaba ölçümdür (requestAnimationFrame sayacı); eşik test edilmez, yalnız raporlanır.

type Probe = { stages: string[]; frames: number; worst: number; ms: number; split: { frames: number; ms: number; worst: number } };
type Raw = { stages: string[]; frames: number; worst: number; t0: number; last: number; on: boolean; sf: number; sms: number; sw: number };

/** Kapı aşamalarını ve kare sayacını sayfa ömrü boyunca (yumuşak gezinmede de) kaydeder. */
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __probe: Raw };
    w.__probe = { stages: [], frames: 0, worst: 0, t0: 0, last: 0, on: false, sf: 0, sms: 0, sw: 0 };
    const seen = (st: string | undefined) => {
      if (st && w.__probe.stages[w.__probe.stages.length - 1] !== st) w.__probe.stages.push(st);
    };
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "attributes" && m.target instanceof HTMLElement && m.target.dataset.testid === "door") seen(m.target.dataset.stage);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-stage"] });
  });
}

async function startFps(page: Page) {
  await page.evaluate(() => {
    const p = (window as unknown as { __probe: Raw }).__probe;
    p.frames = p.sf = p.sms = p.sw = 0;
    p.worst = 0;
    p.on = true;
    p.t0 = p.last = performance.now();
    const f = (t: number) => {
      if (!p.on) return;
      const dt = t - p.last;
      p.frames++;
      p.worst = Math.max(p.worst, dt);
      // Yalnız kapı yarıları kayarken (split) ayrı sayaç: gezinme/hidrasyon karelerinden ayrık.
      if (document.querySelector<HTMLElement>('[data-testid="door"][data-stage="split"]')) {
        p.sf++;
        p.sms += dt;
        p.sw = Math.max(p.sw, dt);
      }
      p.last = t;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
}

async function stopProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const p = (window as unknown as { __probe: Raw }).__probe;
    p.on = false;
    return {
      stages: p.stages,
      frames: p.frames,
      worst: Math.round(p.worst),
      ms: Math.round(performance.now() - p.t0),
      split: { frames: p.sf, ms: Math.round(p.sms), worst: Math.round(p.sw) },
    };
  });
}

function report(label: string, p: Probe) {
  const fps = p.ms ? Math.round((p.frames * 1000) / p.ms) : 0;
  const line = `${label}: ~${fps} fps (${p.frames} kare / ${p.ms} ms, en uzun kare ${p.worst} ms)`;
  const sp = p.split.frames ? `; yarılar kayarken ~${Math.round((p.split.frames * 1000) / Math.max(1, p.split.ms))} fps (en uzun ${p.split.worst} ms)` : "";
  const full = line + sp;
  console.log(`[fps] ${full}`);
  test.info().annotations.push({ type: "fps", description: full });
}

async function submit(page: Page, who: keyof typeof USERS) {
  await page.getByLabel("E-posta").fill(USERS[who]);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

async function sceneFps(page: Page, label: string) {
  await page.waitForTimeout(1400); // giriş koreografisi bitsin
  await startFps(page);
  await page.mouse.move(200, 200);
  await page.mouse.move(900, 500, { steps: 20 });
  await page.waitForTimeout(1200);
  report(`${label} sahne (ortam döngüleri + paralaks)`, await stopProbe(page));
}

async function doorFlow(page: Page, label: string) {
  await startFps(page);
  await submit(page, "yonetici");
  const door = page.getByTestId("door");
  await expect(door.first()).toBeVisible();
  await expect(page).toHaveURL(/\/bugun/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(door).toHaveCount(0, { timeout: 10_000 });
  const p = await stopProbe(page);
  report(`${label} kapı açılışı`, p);
  return p;
}

test.describe("açılış sahnesi ve kapı", () => {
  test.beforeEach(async ({ page }) => installProbe(page));

  test("masaüstü: giriş sonrası kapı açılır, panel yüklenir, kapı kaldırılır", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/giris");
    await expect(page.getByTestId("login-brand")).toBeVisible();
    await expect(page.locator("[data-scene-emblem]")).toHaveCount(1);
    await sceneFps(page, "masaüstü");
    const p = await doorFlow(page, "masaüstü");
    expect(p.stages).toContain("lines");
    expect(p.stages).toContain("split");
    expect(p.stages[p.stages.length - 1]).toBe("open");
  });

  test("mobil (dokunmatik, 4x CPU yavaşlatma): kapı açılır", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await context.newPage();
    await installProbe(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("/giris");
    await expect(page.getByTestId("login-brand")).toBeVisible();
    await page.waitForTimeout(1400);
    await startFps(page);
    await page.waitForTimeout(1500);
    report("mobil 4x sahne (ortam döngüleri)", await stopProbe(page));
    const p = await doorFlow(page, "mobil 4x");
    expect(p.stages).toContain("split");
    await context.close();
  });

  test("azaltılmış hareket: kapı yerine kısa solma", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/giris");
    await submit(page, "yonetici");
    await expect(page).toHaveURL(/\/bugun/);
    await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 5_000 });
    const p = await stopProbe(page);
    expect(p.stages).toContain("closed");
    expect(p.stages).not.toContain("lines");
    expect(p.stages).not.toContain("split");
  });

  test("çift gönderim yok; panelde sayfa geçişi kapıyı oynatmaz", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) posts.push(r.url());
    });
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(USERS.yonetici);
    await page.getByLabel("Şifre").fill(PASSWORD);
    const btn = page.getByRole("button", { name: "Giriş yap" });
    await btn.dblclick();
    await page.getByLabel("Şifre").press("Enter").catch(() => {});
    await expect(page).toHaveURL(/\/bugun/);
    await expect(page.getByTestId("door")).toHaveCount(0, { timeout: 10_000 });
    expect(posts.filter((u) => u.includes("/giris")).length).toBe(1);
    await page.getByRole("link", { name: /Müşteriler/ }).first().click();
    await expect(page).toHaveURL(/\/musteriler/);
    await page.waitForTimeout(400);
    await expect(page.getByTestId("door")).toHaveCount(0);
  });
});
