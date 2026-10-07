import { createHmac, timingSafeEqual } from "node:crypto";

const SIG = /^sha256=([0-9a-fA-F]{64})$/;

/**
 * Meta webhook imzası: `X-Hub-Signature-256: sha256=<hex>`, HAM gövde üzerinde HMAC-SHA256 (META_APP_SECRET).
 * Önek yok, hex bozuk ya da uzunluk farklıysa false; karşılaştırma sabit zamanlıdır.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const m = SIG.exec(header.trim());
  if (!m) return false;
  const given = Buffer.from(m[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
