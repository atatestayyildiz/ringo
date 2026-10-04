/** Rapor aralığı: URL parametreleri (?from&to, YYYY-MM-DD, Europe/Istanbul günleri). */

export const MAX_DAYS = 366;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function toUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDay(v: string | undefined | null): v is string {
  if (!v || !ISO.test(v)) return false;
  return fromUtc(toUtc(v)) === v;
}

export function addDays(key: string, n: number): string {
  return fromUtc(toUtc(key) + n * DAY);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

export type Preset = "today" | "week" | "month" | "lastmonth" | "custom";

export function presetRange(preset: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const dow = new Date(toUtc(today)).getUTCDay(); // 0 pazar
    const back = (dow + 6) % 7; // pazartesi = 0
    return { from: addDays(today, -back), to: today };
  }
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const firstThis = `${today.slice(0, 7)}-01`;
  const lastPrev = addDays(firstThis, -1);
  return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
}

export type ParsedRange = { from: string; to: string; error: string | null };

/** Parametre yoksa bu ay. Geçersizse bu aya düşer ve hata metni döner. */
export function parseRange(rawFrom: string | undefined, rawTo: string | undefined, today: string): ParsedRange {
  const def = presetRange("month", today);
  if (!rawFrom && !rawTo) return { ...def, error: null };
  if (!isValidDay(rawFrom) || !isValidDay(rawTo)) {
    return { ...def, error: "Tarih aralığı geçersiz. Bu ayın raporu gösteriliyor." };
  }
  if (rawTo < rawFrom) return { ...def, error: "Bitiş tarihi başlangıçtan önce olamaz. Bu ayın raporu gösteriliyor." };
  if (daysBetween(rawFrom, rawTo) + 1 > MAX_DAYS) {
    return { ...def, error: `Aralık en fazla ${MAX_DAYS} gün olabilir. Bu ayın raporu gösteriliyor.` };
  }
  return { from: rawFrom, to: rawTo, error: null };
}

export function activePreset(from: string, to: string, today: string): Preset {
  for (const p of ["today", "week", "month", "lastmonth"] as const) {
    const r = presetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}
