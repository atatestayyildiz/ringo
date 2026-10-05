// Kullanım kılavuzunu PDF'e çevirir: node scripts/build-kilavuz.mjs
import { chromium } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "docs", "kilavuz", "kilavuz.html");
const pdf = path.join(root, "docs", "kilavuz", "kilavuz.pdf");

const footer = `
<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#444;padding:0 2cm;display:flex;justify-content:space-between;">
  <span>Telefoncu CRM: Kullanım Kılavuzu</span>
  <span>Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: pdf,
    format: "A4",
    printBackground: false,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footer,
  });
  console.log("Yazıldı:", pdf);
} finally {
  await browser.close();
}
