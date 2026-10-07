import { describe, expect, it } from "vitest";
import { isPublicPath } from "./middleware";

describe("proxy oturumsuz yollar", () => {
  it("yeni tam yollar ve mevcut muafiyetler geçer", () => {
    for (const p of ["/api/meta/webhook", "/gizlilik", "/sifre-sifirla", "/sifre-sifirla/yeni", "/api/cron/notify", "/api/cron/meta-sync"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });
  it("varyantlar geçmez", () => {
    for (const p of [
      "/api/meta",
      "/api/meta/",
      "/api/meta/webhook/",
      "/api/meta/webhook/x",
      "/api/meta/webhookx",
      "/api/meta%2fwebhook",
      "/api/cron-x",
      "/api/cronx/notify",
      "/gizlilik/",
      "/gizlilik-x",
      "/gizlilik/x",
      "/GIZLILIK",
      "/bugun",
      "/api/export/customers",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
