import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config başlıkları", () => {
  it("şifre sıfırlama sayfaları Referer sızdırmaz ve önbelleğe alınmaz", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((r) => r.source === "/sifre-sifirla/:path*");
    expect(rule).toBeDefined();
    const h = Object.fromEntries(rule!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cache-control"]).toBe("no-store");
  });
  it("servis çalışanı önbelleğe alınmaz ve kök kapsamlıdır", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((r) => r.source === "/sw.js");
    expect(rule).toBeDefined();
    const h = Object.fromEntries(rule!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(h["service-worker-allowed"]).toBe("/");
  });
});
