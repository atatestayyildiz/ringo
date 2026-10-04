export type ParsedDate = { y: number; m: number; d: number; h?: number; min?: number };

const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  const cur = new Date().getFullYear() % 100;
  return y > cur ? 1900 + y : 2000 + y;
}

/** Excel seri sayısı (1900 sistemi) -> tarih. Aralık dışı null. */
export function excelSerialToDate(serial: number): ParsedDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  const frac = serial - whole;
  const ms = Date.UTC(1899, 11, 30) + whole * 86_400_000;
  const dt = new Date(ms);
  const out: ParsedDate = { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  if (frac > 0) {
    const mins = Math.round(frac * 1440);
    out.h = Math.floor(mins / 60) % 24;
    out.min = mins % 60;
  }
  return out;
}

/**
 * Desteklenen girdiler: "15.03.1988", "15/03/1988", "15-03-1988", "1988-03-15" (saatli de olabilir),
 * Excel seri sayısı (sayı veya yalnız rakamdan oluşan metin), Date nesnesi (UTC alanları okunur).
 * Geçersiz takvim günü ve 1900 öncesi null döner.
 */
export function parseDate(value: unknown): ParsedDate | null {
  if (value == null || value === "") return null;
  let out: ParsedDate | null = null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    out = { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
    const h = value.getUTCHours();
    const mi = value.getUTCMinutes();
    if (h || mi) {
      out.h = h;
      out.min = mi;
    }
  } else if (typeof value === "number") {
    out = excelSerialToDate(value);
  } else if (typeof value === "string") {
    const s = value.trim();
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/))) {
      out = { y: +m[1], m: +m[2], d: +m[3] };
      if (m[4] != null) {
        out.h = +m[4];
        out.min = +m[5];
      }
    } else if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[T\s]+(\d{1,2}):(\d{2}))?$/))) {
      out = { y: expandYear(+m[3]), m: +m[2], d: +m[1] };
      if (m[4] != null) {
        out.h = +m[4];
        out.min = +m[5];
      }
    } else if (/^\d{4,6}(\.\d+)?$/.test(s)) {
      out = excelSerialToDate(Number(s));
    }
  }

  if (!out) return null;
  if (out.y < 1900 || !valid(out.y, out.m, out.d)) return null;
  if (out.h != null && (out.h > 23 || (out.min ?? 0) > 59)) {
    delete out.h;
    delete out.min;
  }
  return out;
}

/** YYYY-MM-DD */
export function toIsoDate(p: ParsedDate): string {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Saat varsa Istanbul ofsetiyle (+03:00) tam zaman damgası, yoksa yalnız tarih. */
export function toIsoDateTime(p: ParsedDate): string {
  if (p.h == null) return toIsoDate(p);
  return `${toIsoDate(p)}T${pad(p.h)}:${pad(p.min ?? 0)}:00+03:00`;
}

/** Doğum tarihi: gelecekte olamaz, 1900 öncesi olamaz. */
export function birthDateIso(value: unknown, today: Date = new Date()): string | null {
  const p = parseDate(value);
  if (!p) return null;
  const iso = toIsoDate(p);
  const t = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return iso > t ? null : iso;
}
