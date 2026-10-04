/** Excel (Türkçe) uyumlu CSV: UTF-8 BOM, `;` ayraç, CRLF, alan kaçışı, formül enjeksiyonu koruması. */
import { TZ } from "@/lib/format";

export type CsvCell = string | number | null | undefined;

export const CSV_BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/;

/** Tek hücre: formül önekleri ' ile etkisizleştirilir; ; " satır sonu varsa tırnaklanır. */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // Sayılar olduğu gibi (negatif sayı formül sayılmaz), ondalık virgül.
    return Number.isFinite(v) ? String(v).replace(".", ",") : "";
  }
  let s = v;
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: CsvCell[]): string {
  return cells.map(csvCell).join(";");
}

/** Satırları CRLF ile birleştirir, başına BOM ekler. */
export function toCsv(rows: CsvCell[][]): string {
  return CSV_BOM + rows.map(csvRow).join("\r\n") + "\r\n";
}

/** "1990-05-12" (tarih) -> "12.05.1990". Tanınmayan biçim olduğu gibi döner. */
export function csvDate(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}

/** ISO zaman damgası -> "12.05.1990 14:30" (Europe/Istanbul). */
export function csvDateTime(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")} ${g("hour")}:${g("minute")}`;
}

/** 0.4132 -> "%41,3" */
export function csvPercent(rate: number): string {
  return `%${(Math.round(rate * 1000) / 10).toString().replace(".", ",")}`;
}

/** Dosya adı için YYYY-MM-DD (Europe/Istanbul). */
export function fileDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}
