/**
 * CSV baytlarını çözer: UTF-16 BOM'u (Meta Lead Center dosyaları) varsa UTF-16; yoksa önce UTF-8,
 * U+FFFD çıkarsa windows-1254 ile yeniden çözer. BOM atılır.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8).replace(/^﻿/, "");
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8).replace(/^﻿/, "");
  let text = new TextDecoder("utf-8").decode(u8);
  if (text.includes("�")) {
    try {
      text = new TextDecoder("windows-1254").decode(u8);
    } catch {
      // windows-1254 desteklenmiyorsa UTF-8 sonucu kalır
    }
  }
  return text.replace(/^﻿/, "");
}
