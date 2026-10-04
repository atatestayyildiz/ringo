import { createHash, timingSafeEqual } from "node:crypto";

/** Sabit zamanlı karşılaştırma (uzunluk farkı da sızmasın diye özetler karşılaştırılır). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** "Authorization: Bearer xxx" başlığından anahtarı alır, yoksa null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
