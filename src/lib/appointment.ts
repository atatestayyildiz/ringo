import { dayDiff, dayKey } from "./format";

type DateInput = Date | string | number;

export type AppointmentBadge = {
  text: string;
  /** Gün geçmiş: kırmızı tonlu "Gecikti" */
  overdue: boolean;
};

/** DB time ("14:00:00" veya "14:00") -> "14:00". Boş/bozuksa null. */
export function trimTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{2}):(\d{2})/.exec(time);
  return m ? `${m[1]}:${m[2]}` : null;
}

const SHORT_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** "2026-10-12" -> "12 Eki" (saat dilimi kayması olmaz, salt takvim günü). */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

/** Randevu aşamasında ve günü bugünden (Europe/Istanbul) önce ise gecikmiştir. */
export function isAppointmentOverdue(
  stage: string | null | undefined,
  day: string | null | undefined,
  now: DateInput = new Date(),
): boolean {
  return stage === "appointment" && !!day && day < dayKey(now);
}

/** "Bugün 14:00", "Yarın", "12 Eki 10:30", "Belli değil". Gecikmişse overdue=true, metin "Gecikti". */
export function appointmentBadge(
  stage: string | null | undefined,
  day: string | null | undefined,
  time: string | null | undefined,
  now: DateInput = new Date(),
): AppointmentBadge {
  if (!day) return { text: "Belli değil", overdue: false };
  if (isAppointmentOverdue(stage, day, now)) return { text: "Gecikti", overdue: true };
  const diff = dayDiff(`${day}T12:00:00+03:00`, now);
  const t = trimTime(time);
  const base = diff === 0 ? "Bugün" : diff === 1 ? "Yarın" : shortDay(day);
  return { text: t ? `${base} ${t}` : base, overdue: false };
}

/** Huni sıralaması: gün+saat artan; saatsiz günün başında; belli olmayanlar en sonda. */
export function compareAppointments(
  a: { appointment_day: string | null; appointment_time: string | null },
  b: { appointment_day: string | null; appointment_time: string | null },
): number {
  if (!a.appointment_day && !b.appointment_day) return 0;
  if (!a.appointment_day) return 1;
  if (!b.appointment_day) return -1;
  if (a.appointment_day !== b.appointment_day) return a.appointment_day < b.appointment_day ? -1 : 1;
  const ta = trimTime(a.appointment_time) ?? "";
  const tb = trimTime(b.appointment_time) ?? "";
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}
