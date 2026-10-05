import type { Mapping } from "./columns";
import { birthDateIso, parseDate, toIsoDateTime } from "./dates";
import { normalizeTrPhone } from "./phone";

export type Cell = string | number | boolean | Date | null | undefined;

/** import_customers RPC satırı (spec §5). */
export type ImportPayloadRow = {
  full_name: string;
  phone: string;
  phone_alt?: string;
  operator?: string;
  birth_date?: string;
  applied_at?: string;
  note?: string;
};

export type PreparedRow = {
  /** Dosyadaki 1 tabanlı satır numarası (başlık satırı dahil) */
  sheetRow: number;
  payload: ImportPayloadRow;
  /** Gösterim: normalize edilmiş telefon ya da null */
  phoneNormalized: string | null;
  valid: boolean;
  reason?: string;
  /** Dosyada aynı telefonun daha önce geçtiği satır varsa true */
  duplicateInFile: boolean;
  /** Ad ya da notta `?` / bozuk karakter var: dosya ANSI kaydedilmiş olabilir. */
  suspectChars: boolean;
};

export function cellToString(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  if (typeof c === "number") return String(c);
  return String(c).trim();
}

function cellToPhone(c: Cell): string {
  if (typeof c === "number" && Number.isFinite(c)) return String(Math.round(c));
  return cellToString(c);
}

export function isEmptyRow(row: Cell[]): boolean {
  return row.every((c) => cellToString(c) === "");
}

/** Başlık sonrası satırları RPC satırına çevirir; istemci tarafı geçerlilik işareti ekler. */
export function prepareRows(dataRows: Cell[][], map: Mapping, firstSheetRow = 2): PreparedRow[] {
  const seen = new Set<string>();
  const out: PreparedRow[] = [];

  dataRows.forEach((row, i) => {
    if (isEmptyRow(row)) return;
    const get = (idx: number | undefined): Cell => (idx == null ? null : row[idx]);

    let fullName = "";
    if (map.full_name != null) {
      fullName = cellToString(get(map.full_name));
    } else {
      fullName = [cellToString(get(map.first_name)), cellToString(get(map.last_name))].filter(Boolean).join(" ");
    }
    fullName = fullName.replace(/\s+/g, " ").trim();

    const phoneRaw = cellToPhone(get(map.phone));
    const phone = normalizeTrPhone(phoneRaw);
    const altRaw = map.phone_alt != null ? cellToPhone(get(map.phone_alt)) : "";

    const payload: ImportPayloadRow = { full_name: fullName, phone: phoneRaw };
    if (altRaw) payload.phone_alt = altRaw;
    const op = map.operator != null ? cellToString(get(map.operator)) : "";
    if (op) payload.operator = op;
    if (map.birth_date != null) {
      const b = birthDateIso(get(map.birth_date));
      if (b) payload.birth_date = b;
    }
    if (map.applied_at != null) {
      const p = parseDate(get(map.applied_at));
      if (p) payload.applied_at = toIsoDateTime(p);
    }
    const noteParts = [map.note, ...(map.extraNotes ?? [])]
      .filter((idx): idx is number => idx != null)
      .map((idx) => cellToString(row[idx]))
      .filter(Boolean);
    const note = noteParts.join(" · ");
    if (note) payload.note = note;

    let valid = true;
    let reason: string | undefined;
    if (!fullName) {
      valid = false;
      reason = "Ad soyad boş";
    } else if (!phone) {
      valid = false;
      reason = "Telefon numarası geçersiz";
    }

    let duplicateInFile = false;
    if (valid && phone) {
      if (seen.has(phone)) duplicateInFile = true;
      seen.add(phone);
    }

    out.push({
      sheetRow: firstSheetRow + i,
      payload,
      phoneNormalized: phone,
      valid,
      reason,
      duplicateInFile,
      suspectChars: /[?�]/.test(fullName) || /[?�]/.test(note),
    });
  });

  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
