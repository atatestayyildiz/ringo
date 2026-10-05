import { describe, expect, it } from "vitest";
import { appointmentMessage, callbackMessage, messageFor, testMessage } from "./messages";

describe("push mesajları", () => {
  it("geri arama: ad, soyad baş harfi ve saat", () => {
    const m = callbackMessage({ first_name: "Esra", last_initial: "U", at: "14:30" }, "c1");
    expect(m.title).toBe("Geri arama vakti");
    expect(m.body).toBe("Esra U. için 14:30 aramasının vakti geldi.");
    expect(m.url).toBe("/bugun");
    expect(m.tag).toBe("callback-c1");
  });
  it("randevu: saat, ad ve soyad baş harfi", () => {
    const m = appointmentMessage({ first_name: "Can", last_initial: "Y", time: "16:00" }, "c2");
    expect(m.title).toBe("Randevu hatırlatma");
    expect(m.body).toBe("16:00 Can Y. dükkana gelecek.");
    expect(m.tag).toBe("appointment-c2");
  });
  it("soyad baş harfi yoksa nokta konmaz", () => {
    expect(callbackMessage({ first_name: "Esra", at: "09:00" }).body).toBe("Esra için 09:00 aramasının vakti geldi.");
  });
  it("test mesajı", () => {
    const m = testMessage();
    expect(m).toMatchObject({ title: "Ringo test bildirimi", body: "Bildirimler bu cihazda çalışıyor.", url: "/bugun" });
  });
  it("bilinmeyen tür null, bozuk payload çökmez", () => {
    expect(messageFor("morning", {})).toBeNull();
    expect(messageFor("callback", null)?.title).toBe("Geri arama vakti");
  });
  it("em dash ve telefon numarası yok", () => {
    const all = [
      callbackMessage({ first_name: "Esra", last_initial: "U", at: "14:30", phone: "05320000000" }),
      appointmentMessage({ first_name: "Can", last_initial: "Y", time: "16:00" }),
      testMessage(),
    ];
    for (const m of all) {
      expect(`${m.title} ${m.body}`).not.toMatch(/—|\d{10}/);
    }
  });
});
