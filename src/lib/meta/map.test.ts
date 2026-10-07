import { describe, expect, it } from "vitest";
import { mapLead, stripPhonePrefix } from "./map";

describe("mapLead", () => {
  it("full_name ve phone_number; p:+90 önekini siler", () => {
    const r = mapLead([
      { name: "full_name", values: ["Deniz Örnek"] },
      { name: "phone_number", values: ["p:+905550000000"] },
    ]);
    expect(r).toEqual({ fullName: "Deniz Örnek", phone: "+905550000000", note: null });
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
    expect(r.note).toBe("hangi_model: Model A · butce: 10 bin, 15 bin");
  });
  it("eksik ya da bozuk veri hata vermez", () => {
    expect(mapLead(undefined)).toEqual({ fullName: null, phone: null, note: null });
    expect(mapLead([{ name: "phone_number" }, {}, { name: "x", values: [] }] as never)).toEqual({ fullName: null, phone: null, note: null });
  });
  it("stripPhonePrefix", () => {
    expect(stripPhonePrefix(" P:+90 555 ")).toBe("+90 555");
    expect(stripPhonePrefix("0555")).toBe("0555");
  });
});
