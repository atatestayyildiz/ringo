/** CSV baytlarını çözer: önce UTF-8; U+FFFD çıkarsa windows-1254 ile yeniden çözer. BOM atılır. */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
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
