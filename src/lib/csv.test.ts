import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvDate, csvDateTime, csvPercent, csvRow, fileDay, toCsv } from "./csv";

describe("csv", () => {
  it("BOM, ; ayraç ve CRLF kullanır", () => {
    const out = toCsv([
      ["Ad", "Telefon"],
      ["Ali", "0532 123 45 67"],
    ]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toBe(`${CSV_BOM}Ad;Telefon\r\nAli;0532 123 45 67\r\n`);
  });

  it("; tırnak ve satır sonu içeren alanları tırnaklar", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('o "x" y')).toBe('"o ""x"" y"');
    expect(csvCell("satır\nsonu")).toBe('"satır\nsonu"');
    expect(csvCell("düz,virgül")).toBe("düz,virgül");
  });

  it("formül enjeksiyonunu etkisizleştirir", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+90")).toBe("'+90");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("x";"y")')).toBe(`"'=HYPERLINK(""x"";""y"")"`);
    expect(csvCell("normal=metin")).toBe("normal=metin");
  });

  it("null ve sayılar", () => {
    expect(csvRow([null, undefined, 3, -2, 1.5])).toBe(";;3;-2;1,5");
  });

  it("Türkçe tarih biçimi", () => {
    expect(csvDate("1990-05-12")).toBe("12.05.1990");
    expect(csvDate(null)).toBe("");
    expect(csvDateTime("2026-10-04T11:30:00Z")).toBe("04.10.2026 14:30");
    expect(csvDateTime("2026-10-04T21:30:00Z")).toBe("05.10.2026 00:30");
  });

  it("yüzde ve dosya günü", () => {
    expect(csvPercent(0.4132)).toBe("%41,3");
    expect(csvPercent(0)).toBe("%0");
    expect(fileDay(new Date("2026-10-04T22:00:00Z"))).toBe("2026-10-05");
  });
});
