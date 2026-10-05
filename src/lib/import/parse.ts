import Papa from "papaparse";
import { decodeCsvBytes } from "./encoding";
import { normalizeTrPhone } from "./phone";
import { cellToString, isEmptyRow, type Cell } from "./rows";

export type ParsedSheet = {
  headers: string[];
  rows: Cell[][];
  /** İlk satır başlık değil, müşteri verisi. */
  headerless: boolean;
  /** Boş satırlar atılmış, aynı genişliğe getirilmiş tüm satırlar (başlık seçimi değişince yeniden kurulur). */
  all: Cell[][];
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20000;

export class ImportFileError extends Error {}

export const XLS_MESSAGE = "Eski .xls biçimi desteklenmiyor. Dosyayı .xlsx veya .csv olarak kaydedip tekrar yükleyin.";

/** İlk satırda telefon gibi bir hücre varsa o satır başlık değildir (başlıkta numara olmaz). */
function looksHeaderless(first: Cell[]): boolean {
  return first.some((c) => normalizeTrPhone(cellToString(c)) !== null);
}

function build(all: Cell[][], headerless: boolean): ParsedSheet {
  const headers = headerless
    ? all[0].map((_, i) => `Sütun ${i + 1}`)
    : all[0].map((h, i) => {
        const s = h == null ? "" : String(h).trim();
        return s || `Sütun ${i + 1}`;
      });
  const rows = headerless ? all : all.slice(1);
  if (rows.length > MAX_ROWS) {
    throw new ImportFileError(`Dosyada en fazla ${MAX_ROWS} satır olabilir. Dosyayı bölüp tekrar yükleyin.`);
  }
  return { headers, rows, headerless, all };
}

/** Başlık satırı seçimini değiştirir (ilk satırı müşteri verisi say / başlık say). */
export function applyHeaderless(sheet: ParsedSheet, headerless: boolean): ParsedSheet {
  return build(sheet.all, headerless);
}

function finish(all: Cell[][]): ParsedSheet {
  const nonEmpty = all.filter((r) => !isEmptyRow(r));
  if (nonEmpty.length < 2) {
    throw new ImportFileError("Dosyada başlık satırı ve en az bir müşteri satırı olmalı.");
  }
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r: Cell[]) => Array.from({ length: width }, (_, i) => r[i] ?? null);
  const padded = nonEmpty.map(pad);
  return build(padded, looksHeaderless(padded[0]));
}

/** CSV metnini ayrıştırır (ayraç otomatik: virgül, noktalı virgül, sekme). */
export function parseCsvText(text: string): ParsedSheet {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return finish(res.data as Cell[][]);
}

/** Tarayıcıda yüklenen dosyayı okur: .csv, .xlsx. .xls için açıklayıcı hata verir. */
export async function parseImportFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError("Dosya 10 MB'tan büyük. Dosyayı bölüp tekrar yükleyin.");
  }
  if (name.endsWith(".xls")) throw new ImportFileError(XLS_MESSAGE);

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return parseCsvText(decodeCsvBytes(await file.arrayBuffer()));
  }
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    let data: Cell[][];
    try {
      data = (await readSheet(file)) as Cell[][];
    } catch {
      throw new ImportFileError("Dosya okunamadı. Geçerli bir .xlsx olduğundan emin olun veya .csv olarak kaydedin.");
    }
    return finish(data);
  }
  throw new ImportFileError("Desteklenmeyen dosya türü. .xlsx veya .csv yükleyin.");
}
