/** Sunucu action'larında ham veritabanı hata metnini kullanıcıya göstermemek için ortak eşleme. */

export const GENERIC_ERROR = "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

/** Veritabanının kendi Türkçe iş kuralı hataları (22023, 42501, P0002) olduğu gibi gösterilir. */
const PASS_THROUGH = new Set(["22023", "42501", "P0002"]);

const KNOWN: [RegExp, string][] = [
  [/row-level security|permission denied/i, "Bu işlem için yetkiniz yok."],
  [/duplicate key|unique constraint/i, "Bu kayıt zaten var."],
  [/Failed to fetch|NetworkError|fetch failed/i, "Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin."],
];

export type ErrorLike = { code?: string | null; message?: string | null } | null | undefined;

export function toUserMessage(error: ErrorLike): string {
  if (!error) return GENERIC_ERROR;
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (PASS_THROUGH.has(code) && message) return message;
  if (code === "23505") return "Bu kayıt zaten var.";
  if (code === "42501") return "Bu işlem için yetkiniz yok.";
  for (const [re, text] of KNOWN) if (re.test(message)) return text;
  return GENERIC_ERROR;
}

const RELOAD_HINT = "Sayfayı yenileyin; sürerse yöneticinize bildirin.";

/** Sayfa verisi okunamadığında gösterilecek metin. Okuma hatası RLS'den İngilizce gelebilir; 42501 de sabit metne çevrilir. */
export function loadErrorText(error: ErrorLike): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  let known = code === "42501" ? "Bu işlem için yetkiniz yok." : null;
  for (const [re, text] of KNOWN) if (!known && re.test(message)) known = text;
  return known ? `${known} ${RELOAD_HINT}` : RELOAD_HINT;
}
