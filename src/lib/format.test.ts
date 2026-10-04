import { describe, expect, it } from "vitest";
import {
  dayDiff,
  formatDate,
  formatPhone,
  formatTime,
  initials,
  normalizePhone,
  relativeTime,
  waLink,
} from "./format";

// 2026-10-04 12:00 Istanbul (UTC+3)
const NOW = new Date("2026-10-04T09:00:00Z");

describe("telefon", () => {
  it("görüntüleme biçimi", () => {
    expect(formatPhone("05321234567")).toBe("0532 123 45 67");
    expect(formatPhone("+90 532 123 45 67")).toBe("0532 123 45 67");
    expect(formatPhone("5321234567")).toBe("0532 123 45 67");
  });
  it("tanınmayan numara olduğu gibi döner", () => {
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone(null)).toBe("");
  });
  it("normalize", () => {
    expect(normalizePhone("905321234567")).toBe("05321234567");
    expect(normalizePhone("0212 555 11 22")).toBeNull();
  });
  it("wa.me bağlantısı", () => {
    expect(waLink("05321234567")).toBe("https://wa.me/905321234567");
    expect(waLink("abc")).toBeNull();
  });
});

describe("tarih ve saat", () => {
  it("Türkçe biçim, Istanbul saati", () => {
    expect(formatDate("2026-10-04T10:00:00Z")).toBe("4 Ekim 2026");
    expect(formatTime("2026-10-03T18:40:00Z")).toBe("21:40");
  });
  it("gün farkı gece yarısı sınırında Istanbul'a göre", () => {
    // 21:30 UTC = 00:30 ertesi gün Istanbul
    expect(dayDiff("2026-10-04T21:30:00Z", NOW)).toBe(1);
    expect(dayDiff("2026-10-04T20:30:00Z", NOW)).toBe(0);
  });
  it("göreli zaman", () => {
    expect(relativeTime("2026-10-03T18:40:00Z", NOW)).toBe("dün 21:40");
    expect(relativeTime("2026-10-04T04:50:00Z", NOW)).toBe("bugün 07:50");
    expect(relativeTime("2026-10-05T06:00:00Z", NOW)).toBe("yarın 09:00");
    expect(relativeTime("2026-10-07T09:00:00Z", NOW)).toBe("3 gün sonra");
    expect(relativeTime("2026-10-01T09:00:00Z", NOW)).toBe("3 gün önce");
  });
});

describe("baş harfler", () => {
  it("Türkçe büyük harf", () => {
    expect(initials("ışık İnce")).toBe("Iİ");
    expect(initials("Elif Kaya Demir")).toBe("EK");
  });
});
