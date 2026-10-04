import { describe, expect, it } from "vitest";
import { guessMapping, validateMapping, normalizeHeader } from "./columns";
import { birthDateIso, excelSerialToDate, parseDate, toIsoDate, toIsoDateTime } from "./dates";
import { decodeCsvBytes } from "./encoding";
import { parseCsvText } from "./parse";
import { normalizeTrPhone } from "./phone";
import { chunk, prepareRows } from "./rows";

const CP1254: Record<string, number> = {
  Ş: 0xde, ş: 0xfe, İ: 0xdd, ı: 0xfd, Ğ: 0xd0, ğ: 0xf0, Ç: 0xc7, ç: 0xe7, Ö: 0xd6, ö: 0xf6, Ü: 0xdc, ü: 0xfc,
};
function encodeCp1254(s: string): Uint8Array {
  return Uint8Array.from(Array.from(s).map((ch) => CP1254[ch] ?? ch.charCodeAt(0)));
}

describe("telefon normalize (DB ile aynı kural)", () => {
  it("biçimleri 05XXXXXXXXX yapar", () => {
    expect(normalizeTrPhone("0532 123 45 67")).toBe("05321234567");
    expect(normalizeTrPhone("+90 (532) 123-45-67")).toBe("05321234567");
    expect(normalizeTrPhone("905321234567")).toBe("05321234567");
    expect(normalizeTrPhone("5321234567")).toBe("05321234567");
  });
  it("geçersizleri null yapar", () => {
    expect(normalizeTrPhone("0212 555 11 22")).toBeNull();
    expect(normalizeTrPhone("12345")).toBeNull();
    expect(normalizeTrPhone("")).toBeNull();
    expect(normalizeTrPhone(null)).toBeNull();
    expect(normalizeTrPhone("90532123456")).toBeNull();
  });
});

describe("tarih ayrıştırma", () => {
  it("15.03.1988", () => {
    expect(toIsoDate(parseDate("15.03.1988")!)).toBe("1988-03-15");
    expect(toIsoDate(parseDate("15/03/1988")!)).toBe("1988-03-15");
    expect(toIsoDate(parseDate("5-3-1988")!)).toBe("1988-03-05");
  });
  it("1988-03-15", () => {
    expect(toIsoDate(parseDate("1988-03-15")!)).toBe("1988-03-15");
    expect(toIsoDate(parseDate("1988-03-15T10:20:00Z")!)).toBe("1988-03-15");
  });
  it("Excel seri sayısı", () => {
    expect(toIsoDate(parseDate(32217)!)).toBe("1988-03-15");
    expect(toIsoDate(parseDate("32217")!)).toBe("1988-03-15");
    expect(toIsoDate(excelSerialToDate(45000)!)).toBe("2023-03-15");
  });
  it("Date nesnesi (UTC alanları)", () => {
    expect(toIsoDate(parseDate(new Date(Date.UTC(1988, 2, 15)))!)).toBe("1988-03-15");
  });
  it("saat taşıyan değer Istanbul ofsetiyle çıkar", () => {
    expect(toIsoDateTime(parseDate("15.03.2026 14:30")!)).toBe("2026-03-15T14:30:00+03:00");
    expect(toIsoDateTime(parseDate("15.03.2026")!)).toBe("2026-03-15");
  });
  it("geçersiz takvim günü ve boş değer null", () => {
    expect(parseDate("31.02.1990")).toBeNull();
    expect(parseDate("abc")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate("01.01.1850")).toBeNull();
  });
  it("doğum tarihi gelecekte olamaz", () => {
    expect(birthDateIso("15.03.1988", new Date(2026, 9, 4))).toBe("1988-03-15");
    expect(birthDateIso("15.03.2030", new Date(2026, 9, 4))).toBeNull();
  });
});

describe("CSV kodlama", () => {
  it("UTF-8 olduğu gibi çözülür, BOM atılır", () => {
    const bytes = new TextEncoder().encode("﻿Ad;Şehir\nİpek;Ğ");
    expect(decodeCsvBytes(bytes)).toBe("Ad;Şehir\nİpek;Ğ");
  });
  it("windows-1254 baytları UTF-8 çözümü bozulunca yeniden çözülür", () => {
    const bytes = encodeCp1254("Ad Soyad;Telefon\nŞükrü Çağlayan;05321234567\nİpek Öztürk;05320000002");
    const text = decodeCsvBytes(bytes);
    expect(text).toContain("Şükrü Çağlayan");
    expect(text).toContain("İpek Öztürk");
    expect(text).not.toContain("�");
  });
});

describe("sütun tahmini", () => {
  it("ad soyad / telefon / operatör", () => {
    const m = guessMapping(["Ad Soyad", "Telefon", "Operatör", "Doğum Tarihi", "Başvuru Tarihi", "Açıklama"]);
    expect(m).toEqual({ full_name: 0, phone: 1, operator: 2, birth_date: 3, applied_at: 4, note: 5 });
  });
  it("ad ve soyad ayrı sütun", () => {
    const m = guessMapping(["Ad", "Soyad", "GSM", "Tarih", "Not"]);
    expect(m).toEqual({ first_name: 0, last_name: 1, phone: 2, applied_at: 3, note: 4 });
  });
  it("isim + soyad: isim ad olur", () => {
    const m = guessMapping(["İsim", "Soyad", "Tel"]);
    expect(m).toEqual({ first_name: 0, last_name: 1, phone: 2 });
  });
  it("numara, cep, kısa başlıklar", () => {
    expect(guessMapping(["isim", "numara"])).toEqual({ full_name: 0, phone: 1 });
    expect(guessMapping(["Müşteri", "Cep Telefonu", "dogum"])).toEqual({ full_name: 0, phone: 1, birth_date: 2 });
  });
  it("başlık sadeleştirme", () => {
    expect(normalizeHeader("  DOĞUM  Tarihi ")).toBe("dogum tarihi");
    expect(normalizeHeader("İsim")).toBe("isim");
  });
  it("zorunlu alan doğrulaması", () => {
    expect(validateMapping({ phone: 1 })).toMatch(/Ad soyad/);
    expect(validateMapping({ full_name: 0 })).toMatch(/Telefon/);
    expect(validateMapping({ full_name: 0, phone: 1 })).toBeNull();
    expect(validateMapping({ first_name: 0, phone: 1 })).toBeNull();
  });
});

describe("satır hazırlama", () => {
  const headers = ["Ad", "Soyad", "Telefon", "Operatör", "Doğum Tarihi", "Not"];
  const rows = [
    ["Zeynep", "Kurgusal", "0532 000 00 01", "Vodafone", "15.03.1988", "Akşam aransın"],
    ["Ahmet", "Denemeci", "123", "", "", ""],
    ["", "", "", "", "", ""],
    ["Elif", "Misalli", 5320000099, "TC", 32217, ""],
    ["Mehmet", "Testçi", "05320000099", "", "", ""],
  ];
  const map = guessMapping(headers);
  const prepared = prepareRows(rows, map);

  it("boş satırı atlar, satır numarasını korur", () => {
    expect(prepared.map((p) => p.sheetRow)).toEqual([2, 3, 5, 6]);
  });
  it("ad ve soyadı birleştirir, tarihi ISO yapar", () => {
    expect(prepared[0].payload.full_name).toBe("Zeynep Kurgusal");
    expect(prepared[0].payload.birth_date).toBe("1988-03-15");
    expect(prepared[0].payload.note).toBe("Akşam aransın");
    expect(prepared[0].valid).toBe(true);
  });
  it("geçersiz telefonu işaretler", () => {
    expect(prepared[1].valid).toBe(false);
    expect(prepared[1].reason).toBe("Telefon numarası geçersiz");
  });
  it("sayısal telefon hücresi ve Excel seri tarihi", () => {
    expect(prepared[2].phoneNormalized).toBe("05320000099");
    expect(prepared[2].payload.birth_date).toBe("1988-03-15");
    expect(prepared[2].valid).toBe(true);
  });
  it("dosya içi tekrarı işaretler", () => {
    expect(prepared[2].duplicateInFile).toBe(false);
    expect(prepared[3].duplicateInFile).toBe(true);
  });
  it("ad boşsa geçersiz", () => {
    const p = prepareRows([["", "05321234567"]], { full_name: 0, phone: 1 });
    expect(p[0].valid).toBe(false);
    expect(p[0].reason).toBe("Ad soyad boş");
  });
});

describe("CSV ayrıştırma ve parçalama", () => {
  it("noktalı virgül ayraçlı CSV", () => {
    const sheet = parseCsvText("Ad Soyad;Telefon\nİpek Öztürk;0532 000 00 03\n\nCan Kurgusal;05320000004\n");
    expect(sheet.headers).toEqual(["Ad Soyad", "Telefon"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0][0]).toBe("İpek Öztürk");
  });
  it("yalnız başlık varsa hata verir", () => {
    expect(() => parseCsvText("Ad;Telefon\n")).toThrow(/en az bir müşteri/);
  });
  it("500'lük parçalar", () => {
    const parts = chunk(Array.from({ length: 1201 }, (_, i) => i), 500);
    expect(parts.map((p) => p.length)).toEqual([500, 500, 201]);
  });
});
