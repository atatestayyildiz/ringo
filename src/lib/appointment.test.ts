import { describe, expect, it } from "vitest";
import {
  appointmentBadge,
  compareAppointments,
  isAppointmentOverdue,
  shortDay,
  trimTime,
} from "./appointment";

// 2026-10-05 12:00 Istanbul
const NOW = new Date("2026-10-05T09:00:00Z");

describe("appointmentBadge", () => {
  it("bugün saatle", () => {
    expect(appointmentBadge("appointment", "2026-10-05", "14:00:00", NOW)).toEqual({ text: "Bugün 14:00", overdue: false });
  });
  it("yarın saatsiz", () => {
    expect(appointmentBadge("appointment", "2026-10-06", null, NOW)).toEqual({ text: "Yarın", overdue: false });
  });
  it("uzak gün kısa tarih", () => {
    expect(appointmentBadge("appointment", "2026-10-12", "10:30", NOW).text).toBe("12 Eki 10:30");
  });
  it("belli değil", () => {
    expect(appointmentBadge("appointment", null, null, NOW)).toEqual({ text: "Belli değil", overdue: false });
  });
  it("geçmiş gün gecikti", () => {
    expect(appointmentBadge("appointment", "2026-10-04", "10:00", NOW)).toEqual({ text: "Gecikti", overdue: true });
  });
  it("randevu aşamasında değilse gecikmez", () => {
    expect(isAppointmentOverdue("visited", "2026-10-04", NOW)).toBe(false);
  });
});

describe("saat dilimi sınırları (Europe/Istanbul)", () => {
  it("UTC 21:30 İstanbul'da ertesi gündür: o gün artık bugün", () => {
    const late = new Date("2026-10-05T21:30:00Z"); // 6 Eki 00:30 İstanbul
    expect(appointmentBadge("appointment", "2026-10-06", "09:00", late).text).toBe("Bugün 09:00");
    expect(isAppointmentOverdue("appointment", "2026-10-05", late)).toBe(true);
  });
  it("UTC 20:59 hala aynı gün", () => {
    const edge = new Date("2026-10-05T20:59:00Z"); // 5 Eki 23:59 İstanbul
    expect(isAppointmentOverdue("appointment", "2026-10-05", edge)).toBe(false);
    expect(appointmentBadge("appointment", "2026-10-06", null, edge).text).toBe("Yarın");
  });
});

describe("yardımcılar", () => {
  it("trimTime", () => {
    expect(trimTime("09:05:00")).toBe("09:05");
    expect(trimTime(null)).toBeNull();
  });
  it("shortDay", () => {
    expect(shortDay("2026-01-03")).toBe("3 Oca");
  });
  it("sıralama: tarih, saat, belli olmayan sonda", () => {
    const rows = [
      { id: "d", appointment_day: null, appointment_time: null },
      { id: "c", appointment_day: "2026-10-07", appointment_time: "09:00:00" },
      { id: "b", appointment_day: "2026-10-06", appointment_time: "15:00:00" },
      { id: "a", appointment_day: "2026-10-06", appointment_time: null },
    ];
    expect(rows.sort(compareAppointments).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});
