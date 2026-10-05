import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  helpText,
  linkedText,
  linkFailedText,
  morningText,
  notificationText,
  summaryText,
  trDate,
} from "./messages";

const URL_ = "https://app.example.com/";

describe("escapeHtml", () => {
  it("kaçışlar", () => {
    expect(escapeHtml("<b>A & B</b>")).toBe("&lt;b&gt;A &amp; B&lt;/b&gt;");
  });
});

describe("trDate", () => {
  it("Türkçe gün ay", () => {
    expect(trDate("2026-10-04")).toBe("4 Ekim");
    expect(trDate("2026-01-15")).toBe("15 Ocak");
    expect(trDate("2026-12-31")).toBe("31 Aralık");
    expect(trDate("2026-08-02")).toBe("2 Ağustos");
  });
  it("geçersizde kaçışlı geri döner", () => {
    expect(trDate("<x>")).toBe("&lt;x&gt;");
  });
});

describe("morningText", () => {
  it("spec örneği", () => {
    const t = morningText(
      { first_name: "Elif", total: 12, retries: 3, new: 9, birthdays: [{ full_name: "Hakan Yıldız", days_left: 3 }] },
      URL_,
    );
    expect(t).toBe(
      "Günaydın Elif. Bugün 12 kişi aranacak: 3 tekrar arama, 9 yeni. Doğum günü yaklaşan: Hakan Yıldız (3 gün). Listeyi aç: https://app.example.com/bugun",
    );
  });
  it("doğum günü yoksa o cümle yok, bugün için 'bugün'", () => {
    expect(morningText({ first_name: "Elif", total: 1, retries: 0, new: 1 }, URL_)).not.toContain("Doğum");
    expect(
      morningText({ first_name: "E", total: 1, retries: 0, new: 1, birthdays: [{ full_name: "Ali", days_left: 0 }] }),
    ).toContain("Ali (bugün)");
  });
  it("isimleri kaçışlar", () => {
    expect(morningText({ first_name: "<i>", total: 1, retries: 0, new: 1 })).toContain("Günaydın &lt;i&gt;.");
  });
  it("APP_URL yoksa link yok", () => {
    expect(morningText({ first_name: "E", total: 1, retries: 0, new: 1 })).not.toContain("Listeyi aç");
  });
});

describe("summaryText", () => {
  it("spec örneği", () => {
    const t = summaryText(
      {
        day: "2026-10-04",
        totals: { assigned: 48, done: 41, reached: 31, appointments: 14, retries: 7 },
        members: [{ full_name: "Elif Demir", assigned: 12, done: 12, appointments: 5 }],
      },
      URL_,
    );
    expect(t).toBe(
      "Bugünün özeti (4 Ekim): 48 atama, 41 tamamlandı, 31 ulaşıldı, 14 randevu, 7 tekrar. Elif 12/12 (5 randevu). Ayrıntı: https://app.example.com/raporlar",
    );
  });
  it("çok kişide keser", () => {
    const members = Array.from({ length: 15 }, (_, i) => ({
      full_name: `K${i} Soyad`,
      assigned: 1,
      done: 1,
      appointments: 0,
    }));
    expect(summaryText({ day: "2026-10-04", totals: {}, members })).toContain("ve 3 kişi daha");
  });
});

describe("diğer metinler", () => {
  it("linkedText", () => {
    expect(linkedText("Elif Demir", "Demo & Ortakları")).toContain(
      "Merhaba Elif, bu sohbet Demo &amp; Ortakları hesabına",
    );
  });
  it("linkFailedText nedene göre", () => {
    expect(linkFailedText("expired")).toContain("süresi dolmuş");
    expect(linkFailedText("used")).toContain("kullanılmış");
    expect(linkFailedText("invalid")).toContain("geçersiz");
  });
  it("helpText", () => {
    expect(helpText(URL_)).toContain("/start KOD");
    expect(helpText(URL_)).toContain("https://app.example.com/profil");
  });
  it("notificationText türe göre", () => {
    expect(notificationText("morning", null)).toContain("Günaydın");
  });
  it("kullanıcıya görünen metinde em dash yok", () => {
    const all = [
      morningText({ first_name: "A", total: 1, retries: 0, new: 1, birthdays: [{ full_name: "B", days_left: 1 }] }, URL_),
      summaryText({ day: "2026-10-04", totals: {}, members: [] }, URL_),
      linkedText("A", "T"),
      helpText(URL_),
      linkFailedText("x"),
    ].join(" ");
    expect(all).not.toContain("—");
  });
});
