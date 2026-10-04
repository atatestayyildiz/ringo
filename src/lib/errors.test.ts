import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, toUserMessage } from "./errors";

describe("toUserMessage", () => {
  it("22023 ve 42501 Türkçe DB mesajını olduğu gibi geçirir", () => {
    expect(toUserMessage({ code: "22023", message: "Geçersiz değer." })).toBe("Geçersiz değer.");
    expect(toUserMessage({ code: "42501", message: "Bu işlemi yapamazsınız." })).toBe("Bu işlemi yapamazsınız.");
  });
  it("boş mesajlı 42501 genel yetki mesajı verir", () => {
    expect(toUserMessage({ code: "42501", message: "" })).toBe("Bu işlem için yetkiniz yok.");
  });
  it("23505 mükerrer kayıt mesajı verir", () => {
    expect(toUserMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "Bu kayıt zaten var.",
    );
  });
  it("bilinen İngilizce mesajları çevirir", () => {
    expect(toUserMessage({ message: 'new row violates row-level security policy for table "customers"' })).toBe(
      "Bu işlem için yetkiniz yok.",
    );
    expect(toUserMessage({ message: "TypeError: Failed to fetch" })).toContain("Bağlantı");
  });
  it("bilinmeyen hatada ham metni sızdırmaz", () => {
    expect(toUserMessage({ code: "XX000", message: "internal table foo exploded" })).toBe(GENERIC_ERROR);
    expect(toUserMessage(null)).toBe(GENERIC_ERROR);
  });
});
