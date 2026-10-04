import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, isAllowedLogoUrl, ownLogoPath, sniffLogoType, validateLogoFile } from "./brand-logo";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

const SB = "http://127.0.0.1:54321";
const T = "10000000-0000-4000-8000-000000000001";

describe("logo dosya doğrulama", () => {
  it("PNG, JPEG, WebP içeriğini tanır", () => {
    expect(sniffLogoType(png)).toBe("image/png");
    expect(sniffLogoType(jpg)).toBe("image/jpeg");
    expect(sniffLogoType(webp)).toBe("image/webp");
  });
  it("SVG ve HTML reddedilir, bildirilen tür yanıltsa bile", () => {
    expect(validateLogoFile(svg, "image/png").ok).toBe(false);
    expect(validateLogoFile(svg, "image/svg+xml").ok).toBe(false);
    expect(validateLogoFile(html, "image/png").ok).toBe(false);
  });
  it("içerik ile bildirilen tür uyuşmazsa reddeder", () => {
    expect(validateLogoFile(png, "image/jpeg").ok).toBe(false);
    expect(validateLogoFile(png, "image/png")).toEqual({ ok: true, mime: "image/png", ext: "png" });
  });
  it("boş ve büyük dosyayı reddeder; sınır dahil kabul", () => {
    expect(validateLogoFile(new Uint8Array(0)).ok).toBe(false);
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(validateLogoFile(big).ok).toBe(false);
    const edge = new Uint8Array(LOGO_MAX_BYTES);
    edge.set(png);
    expect(validateLogoFile(edge).ok).toBe(true);
  });
});

describe("logo adresi", () => {
  it("https serbest, http yalnız kendi depomuz", () => {
    expect(isAllowedLogoUrl("https://example.test/a.png", SB)).toBe(true);
    expect(isAllowedLogoUrl("http://example.test/a.png", SB)).toBe(false);
    expect(isAllowedLogoUrl(`${SB}/storage/v1/object/public/brand-logos/${T}/x.png`, SB)).toBe(true);
    expect(isAllowedLogoUrl(`${SB}/storage/v1/object/public/baska/${T}/x.png`, SB)).toBe(false);
    expect(isAllowedLogoUrl("javascript:alert(1)", SB)).toBe(false);
  });
  it("nesne yolu yalnız kendi kiracı önekinde çıkar", () => {
    const base = `${SB}/storage/v1/object/public/brand-logos/`;
    expect(ownLogoPath(`${base}${T}/logo.png`, SB, T)).toBe(`${T}/logo.png`);
    expect(ownLogoPath(`${base}10000000-0000-4000-8000-000000000002/logo.png`, SB, T)).toBeNull();
    expect(ownLogoPath(`${base}${T}/../x/logo.png`, SB, T)).toBeNull();
    expect(ownLogoPath("https://example.test/a.png", SB, T)).toBeNull();
    expect(ownLogoPath(null, SB, T)).toBeNull();
  });
});
