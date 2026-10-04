/**
 * normalize_tr_phone (DB) ile aynı kural: rakam dışını at; `90` ile başlayıp 12 haneyse `0`+son 10;
 * 10 hane ve `5` ile başlıyorsa `0` ekle; sonuç `05` ile başlayan 11 hane değilse null.
 */
export function normalizeTrPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("90") && d.length === 12) d = "0" + d.slice(2);
  else if (d.length === 10 && d.startsWith("5")) d = "0" + d;
  return /^05\d{9}$/.test(d) ? d : null;
}
