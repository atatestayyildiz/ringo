export const TZ = "Europe/Istanbul";

type DateInput = Date | string | number;

function toDate(v: DateInput): Date {
  return v instanceof Date ? v : new Date(v);
}

function digitsOf(v: string): string {
  return v.replace(/\D/g, "");
}

/** Telefonu 05XXXXXXXXX biçimine getirir; olmazsa null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = digitsOf(raw);
  if (d.startsWith("90") && d.length === 12) d = "0" + d.slice(2);
  else if (d.length === 10 && d.startsWith("5")) d = "0" + d;
  return /^05\d{9}$/.test(d) ? d : null;
}

/** 05321234567 -> "0532 123 45 67". Tanınmayan biçim olduğu gibi döner. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const n = normalizePhone(raw);
  if (!n) return raw;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7, 9)} ${n.slice(9, 11)}`;
}

/** 05XXXXXXXXX -> https://wa.me/90XXXXXXXXXX. Geçersizse null. */
export function waLink(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  return n ? `https://wa.me/90${n.slice(1)}` : null;
}

/** tel: bağlantısı için. Geçersizse null. */
export function telLink(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  return n ? `tel:${n}` : null;
}

export function formatDate(v: DateInput): string {
  return toDate(v).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
}

export function formatDayMonth(v: DateInput): string {
  return toDate(v).toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: TZ });
}

export function formatWeekday(v: DateInput): string {
  return toDate(v).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
}

export function formatTime(v: DateInput): string {
  return toDate(v).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
}

export function formatDateTime(v: DateInput): string {
  return `${formatDate(v)} ${formatTime(v)}`;
}

/** Europe/Istanbul takvim günü, YYYY-MM-DD. */
export function dayKey(v: DateInput): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(toDate(v));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Bugüne göre takvim günü farkı (yarın = 1, dün = -1). */
export function dayDiff(v: DateInput, now: DateInput = new Date()): number {
  return Math.round(dayNumber(dayKey(v)) - dayNumber(dayKey(now)));
}

/** "dün 21:40", "bugün 07:50", "yarın 09:00", "3 gün sonra", "3 gün önce". */
export function relativeTime(v: DateInput, now: DateInput = new Date()): string {
  const diff = dayDiff(v, now);
  const time = formatTime(v);
  if (diff === 0) return `bugün ${time}`;
  if (diff === -1) return `dün ${time}`;
  if (diff === 1) return `yarın ${time}`;
  if (diff > 1) return `${diff} gün sonra`;
  return `${-diff} gün önce`;
}

/** Ad Soyad -> "AS" (Türkçe büyük harf). */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");
}
