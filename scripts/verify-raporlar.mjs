// Raporlar + CSV dışa aktarma doğrulaması. Dev sunucusu http://localhost:3200'de çalışmalı.
// Kullanım: node scripts/verify-raporlar.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const PASSWORD = "Demo1234!";
const out = [];
const check = (name, ok, extra = "") => {
  out.push(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  if (!ok) process.exitCode = 1;
};

async function login(browser, email, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto(`${BASE}/giris`);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/bugun/);
  return { context, page };
}

const browser = await chromium.launch();
fs.mkdirSync("scripts/screens", { recursive: true });

// --- yonetici
{
  const { context, page } = await login(browser, "yonetici@demo.test", { width: 1280, height: 900 });
  const res = await page.request.get(`${BASE}/api/export/customers?durum=pending`);
  const buf = await res.body();
  const text = buf.toString("utf8");
  check("customers 200", res.status() === 200, String(res.status()));
  check("customers BOM", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  check("customers header", text.replace(/^﻿/, "").split("\r\n")[0] === "Ad Soyad;Telefon;Operatör;Durum;Aşama;Atanan;Kaynak;Başvuru;Doğum Tarihi;Son Not;Oluşturma");
  check("customers filename", /attachment; filename="musteriler-\d{4}-\d{2}-\d{2}\.csv"/.test(res.headers()["content-disposition"] ?? ""), res.headers()["content-disposition"]);
  const lines = text.split("\r\n").filter(Boolean);
  check("customers satır sayısı", lines.length >= 1, `${lines.length - 1} veri satırı`);
  if (lines[1]) out.push("     örnek satır: " + lines[1]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const rr = await page.request.get(`${BASE}/api/export/report?from=${today.slice(0, 7)}-01&to=${today}`);
  const rt = (await rr.body()).toString("utf8");
  check("report 200", rr.status() === 200, String(rr.status()));
  check("report bölümleri", ["Özet", "Çalışanlar", "Günlük", "Arama sonuçları", "Kaynak performansı", "Operatör"].every((x) => rt.includes(`\r\n${x}\r\n`) || rt.includes(`\r\n\r\n${x}\r\n`)));
  const bad = await page.request.get(`${BASE}/api/export/report?from=2024-01-01&to=2026-01-01`);
  check("report 366 gün sınırı 400", bad.status() === 400, String(bad.status()));

  await page.goto(`${BASE}/raporlar`);
  await page.waitForSelector("h1");
  const body = await page.locator("main, body").first().innerText();
  check("raporlar yonetici açılır", /Raporlar/.test(body) && /Aranan müşteri/.test(body), body.slice(0, 120).replace(/\n/g, " | "));
  check("raporlar em dash yok", !body.includes("—"));
  await page.screenshot({ path: "scripts/screens/raporlar-desktop.png", fullPage: true });
  out.push("     KPI metni: " + body.split("\n").filter((l) => l.trim()).slice(0, 40).join(" | "));
  await page.goto(`${BASE}/raporlar?from=2026-02-31&to=2026-03-01`);
  check("geçersiz aralık uyarısı", /geçersiz/i.test(await page.locator("body").innerText()));
  await page.goto(`${BASE}/musteriler?durum=pending`);
  const href = await page.getByRole("link", { name: "Dışa aktar" }).getAttribute("href");
  check("Dışa aktar bağlantısı filtreyi korur", href === "/api/export/customers?durum=pending", href ?? "yok");
  await context.close();
}

// --- elif: 403 + yönlendirme
{
  const { context, page } = await login(browser, "elif@demo.test", { width: 375, height: 800 });
  const r1 = await page.request.get(`${BASE}/api/export/customers`);
  const r2 = await page.request.get(`${BASE}/api/export/report?from=2026-10-01&to=2026-10-04`);
  check("elif customers 403", r1.status() === 403, String(r1.status()));
  check("elif report 403", r2.status() === 403, String(r2.status()));
  // elif seed'de view_reports yetkili (export yok): sayfa açılır, CSV düğmesi yok.
  await page.goto(`${BASE}/raporlar`);
  check("elif /raporlar açılır (view_reports)", /\/raporlar/.test(page.url()), page.url());
  check("elif CSV düğmesi yok", (await page.getByText("Raporu indir (CSV)").count()) === 0);
  await context.close();
}

// --- ayse: yetkisiz; Raporlar yalnız kendi kapsamı, Yönetim -> /bugun
{
  const { context, page } = await login(browser, "ayse@demo.test", { width: 1280, height: 800 });
  await page.goto(`${BASE}/raporlar`);
  await page.waitForSelector("h1");
  const body = await page.locator("main").innerText();
  check("ayse /raporlar açılır", /\/raporlar/.test(page.url()), page.url());
  check("ayse yalnız kendi kapsamı", /Yalnız sizin sonuçlarınız|Bu aralıkta kayıt yok/.test(body));
  check("ayse ekip tablosu yok", !/Çalışanlar/.test(body));
  check("ayse CSV düğmesi yok", (await page.getByText("Raporu indir (CSV)").count()) === 0);
  await page.goto(`${BASE}/yonetim`);
  await page.waitForURL(/\/bugun/);
  check("ayse /yonetim -> /bugun", /\/bugun/.test(page.url()), page.url());
  const r = await page.request.get(`${BASE}/api/export/customers`);
  check("ayse customers 403", r.status() === 403, String(r.status()));
  await context.close();
}

// --- oturumsuz
{
  const context = await browser.newContext();
  const r = await context.request.get(`${BASE}/api/export/customers`, { maxRedirects: 0 });
  check("oturumsuz 401 veya giriş yönlendirmesi", [401, 307, 302, 303].includes(r.status()), String(r.status()));
  await context.close();
}

// --- 375px görüntü
{
  const { context, page } = await login(browser, "yonetici@demo.test", { width: 375, height: 800 });
  await page.goto(`${BASE}/raporlar`);
  await page.waitForSelector("h1");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("375px yatay taşma yok", overflow <= 0, `taşma ${overflow}px`);
  await page.screenshot({ path: "scripts/screens/raporlar-375.png", fullPage: true });
  await context.close();
}

await browser.close();
console.log(out.join("\n"));
