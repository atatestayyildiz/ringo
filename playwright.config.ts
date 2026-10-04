import { defineConfig, devices } from "@playwright/test";

// Dev sunucusu dışarıdan çalışır (webServer yok). Testler tek işçide, sırayla koşar:
// ortak veritabanında dağıtım ve ayar testleri birbirini etkilemesin.
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  outputDir: "e2e/.output",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
