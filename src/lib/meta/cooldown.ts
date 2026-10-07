export const SYNC_COOLDOWN_MS = 2 * 60 * 1000;
export const SYNC_COOLDOWN_TEXT = "Az önce tarandı. Birkaç dakika sonra tekrar deneyin.";

/** "Şimdi tara" hız sınırı: son tarama 2 dakikadan yeniyse Türkçe ret metni, değilse null. */
export function syncCooldownError(lastSyncAt: string | null, now: Date = new Date()): string | null {
  if (!lastSyncAt) return null;
  const t = new Date(lastSyncAt).getTime();
  if (Number.isNaN(t)) return null;
  return now.getTime() - t < SYNC_COOLDOWN_MS ? SYNC_COOLDOWN_TEXT : null;
}
