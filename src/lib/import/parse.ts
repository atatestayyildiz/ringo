import Papa from "papaparse";
import { decodeCsvBytes } from "./encoding";
import { isEmptyRow, type Cell } from "./rows";

export type ParsedSheet = { headers: string[]; rows: Cell[][] };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20000;

export class ImportFileError extends Error {}

export const XLS_MESSAGE = "Eski .xls biçimi desteklenmiyor. Dosyayı .xlsx veya .csv olarak kaydedip tekrar yükleyin.";

function finish(all: Cell[][]): ParsedSheet {
  const nonEmpty = all.filter((r) => !isEmptyRow(r));
  if (nonEmpty.length < 2) {
    throw new ImportFileError("Dosyada başlık satırı ve en az bir müşteri satırı olmalı.");
  }
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r: Cell[]) => Array.from({ length: width }, (_, i) => r[i] ?? null);
  const headers = pad(nonEmpty[0]).map((h, i) => {
    const s = h == null ? "" : String(h).trim();
    return s || `Sütun ${i + 1}`;
  });
  const rows = nonEmpty.slice(1).map(pad);
  if (rows.length > MAX_ROWS) {
    throw new ImportFileError(`Dosyada en fazla ${MAX_ROWS} satır olabilir. Dosyayı bölüp tekrar yükleyin.`);
  }
  return { headers, rows };
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
