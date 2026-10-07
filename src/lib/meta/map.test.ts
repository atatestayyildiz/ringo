import { describe, expect, it } from "vitest";
import { mapLead, stripPhonePrefix } from "./map";

describe("mapLead", () => {
  it("full_name ve phone_number; p:+90 önekini siler", () => {
    const r = mapLead([
      { name: "full_name", values: ["Deniz Örnek"] },
      { name: "phone_number", values: ["p:+905550000000"] },
    ]);
    expect(r).toEqual({ fullName: "Deniz Örnek", phone: "+905550000000", phoneAlt: null, amount: null, operator: null, note: null });
  });
  it("ad ve soyadı birleştirir; phone yedeği çalışır", () => {
    const r = mapLead([
      { name: "first_name", values: ["Deniz"] },
      { name: "last_name", values: ["Örnek"] },
      { name: "phone", values: ["p:05550000000"] },
    ]);
    expect(r.fullName).toBe("Deniz Örnek");
    expect(r.phone).toBe("05550000000");
  });
  it("full_name varsa onu tercih eder, phone_number phone'a üstündür", () => {
    const r = mapLead([
      { name: "phone", values: ["111"] },
      { name: "phone_number", values: ["222"] },
      { name: "first_name", values: ["A"] },
      { name: "full_name", values: ["Tam Ad"] },
    ]);
    expect(r.fullName).toBe("Tam Ad");
    expect(r.phone).toBe("222");
  });
  it("ek soruları notta 'soru: cevap' olarak ' · ' ile birleştirir", () => {
    const r = mapLead([
      { name: "full_name", values: ["Deniz Örnek"] },
      { name: "hangi_model", values: ["Model A"] },
      { name: "butce", values: ["10 bin", "15 bin"] },
      { name: "bos", values: [""] },
    ]);
    expect(r.note).toBe("Hangi model: Model A · Butce: 10 bin, 15 bin");
  });
  it("eksik ya da bozuk veri hata vermez", () => {
    expect(mapLead(undefined)).toEqual({ fullName: null, phone: null, phoneAlt: null, amount: null, operator: null, note: null });
    expect(mapLead([{ name: "phone_number" }, {}, { name: "x", values: [] }] as never)).toEqual({ fullName: null, phone: null, phoneAlt: null, amount: null, operator: null, note: null });
  });
  it("stripPhonePrefix", () => {
    expect(stripPhonePrefix(" P:+90 555 ")).toBe("+90 555");
    expect(stripPhonePrefix("0555")).toBe("0555");
  });
});

describe("mapLead soru türüne göre", () => {
  it("özel anahtarlı formda FULL_NAME ve PHONE türlerinden eşler, kalan sorular notta kalır", () => {
    const types = { adi_soyadi: "FULL_NAME", telefon_numarasi: "PHONE", telefonno: "CUSTOM", tutar: "CUSTOM" };
    const r = mapLead(
      [
        { name: "tutar", values: ["10-30 Bin₺"] },
        { name: "telefonno", values: ["05550000001"] },
        { name: "adi_soyadi", values: ["Deniz Örnek"] },
        { name: "telefon_numarasi", values: ["p:+905550000000"] },
        { name: "inbox_url", values: [""] },
      ],
      types,
    );
    expect(r.fullName).toBe("Deniz Örnek");
    expect(r.phone).toBe("+905550000000");
    expect(r.note).toBeNull();
    expect(r.amount).toBe("10-30 Bin₺");
    expect(r.phoneAlt).toBe("05550000001");
  });
  it("tür bilinmiyorsa standart anahtarlara düşer", () => {
    expect(mapLead([{ name: "adi_soyadi", values: ["Deniz Örnek"] }], {}).fullName).toBeNull();
  });
});

describe("mapLead teknik alanlar", () => {
  it("inbox_url notta ve alanlarda yer almaz", () => {
    const r = mapLead([
      { name: "full_name", values: ["Deniz Örnek"] },
      { name: "inbox_url", values: ["https://business.facebook.com/latest/1?nav_ref=thread_view_by_psid"] },
      { name: "hangi_model", values: ["Model A"] },
    ]);
    expect(r.note).toBe("Hangi model: Model A");
  });
});

describe("mapLead operatör", () => {
  it("anahtarında operatör geçen soru Operatör alanına gider, notta tekrarlanmaz", () => {
    const r = mapLead([
      { name: "tutar", values: ["50-100"] },
      { name: "hangi_operatörü_kullanıyorsunuz", values: ["turkcell"] },
    ]);
    expect(r.operator).toBe("turkcell");
    expect(r.note).toBeNull();
    expect(r.amount).toBe("50-100");
  });
  it("operatör sorusu yoksa null", () => {
    expect(mapLead([{ name: "tutar", values: ["50-100"] }]).operator).toBeNull();
  });
});
