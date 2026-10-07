import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature";

const secret = "test-app-secret";
const body = '{"object":"page","entry":[]}';
const sig = (b: string, s = secret) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

describe("verifySignature", () => {
  it("geçerli imzayı kabul eder", () => {
    expect(verifySignature(body, sig(body), secret)).toBe(true);
  });
  it("büyük harfli hex de geçerlidir", () => {
    expect(verifySignature(body, sig(body).replace("sha256=", "sha256=").toUpperCase().replace("SHA256=", "sha256="), secret)).toBe(true);
  });
  it("gövde ya da sır farklıysa reddeder", () => {
    expect(verifySignature(body + " ", sig(body), secret)).toBe(false);
    expect(verifySignature(body, sig(body, "baska"), secret)).toBe(false);
  });
  it("eksik başlık ve boş sırrı reddeder", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
    expect(verifySignature(body, sig(body), "")).toBe(false);
  });
  it("bozuk önek, bozuk hex ve uzunluk farkını reddeder (hata fırlatmaz)", () => {
    const hex = sig(body).slice("sha256=".length);
    for (const h of [hex, `sha1=${hex}`, `sha256=${hex.slice(2)}`, `sha256=${hex}00`, `sha256=${"z".repeat(64)}`, "sha256=", "sha256"]) {
      expect(verifySignature(body, h, secret)).toBe(false);
    }
  });
});
