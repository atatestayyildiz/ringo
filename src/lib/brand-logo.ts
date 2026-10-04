/** Marka logosu: dosya doğrulama (gerçek içerik) ve depolama adresi yardımcıları. SVG bilerek yok (XSS). */

export const LOGO_BUCKET = "brand-logos";
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export type LogoMime = keyof typeof LOGO_TYPES;

export type LogoCheck = { ok: true; mime: LogoMime; ext: string } | { ok: false; error: string };

/** Dosyanın ilk baytlarına bakarak türü belirler; uzantıya ve istemcinin bildirdiği türe güvenilmez. */
export function sniffLogoType(b: Uint8Array): LogoMime | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export function validateLogoFile(bytes: Uint8Array, declaredMime?: string): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: "Dosya boş." };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: "Logo en fazla 512 KB olabilir." };
  const mime = sniffLogoType(bytes);
  if (!mime) return { ok: false, error: "Yalnız PNG, JPEG veya WebP yüklenebilir." };
  if (declaredMime && declaredMime !== mime) return { ok: false, error: "Dosya türü içeriğiyle uyuşmuyor." };
  return { ok: true, mime, ext: LOGO_TYPES[mime] };
}

/** Kamu depolama adresinin ön eki: <supabase>/storage/v1/object/public/brand-logos/ */
export function logoPublicPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${LOGO_BUCKET}/`;
}

/** Bu uygulamanın kendi logo deposundaki adres mi (yerelde http olabilir). */
export function isOwnLogoUrl(url: string, supabaseUrl: string): boolean {
  return url.startsWith(logoPublicPrefix(supabaseUrl)) && !url.includes("?") && !url.includes("#");
}

/** Kaydedilebilir logo adresi: https ya da kendi depomuz. */
export function isAllowedLogoUrl(url: string, supabaseUrl: string | undefined): boolean {
  try {
    if (new URL(url).protocol === "https:") return true;
  } catch {
    return false;
  }
  return Boolean(supabaseUrl) && isOwnLogoUrl(url, supabaseUrl!);
}

/** Depo adresinden nesne yolunu çıkarır; yalnız verilen kiracının önekindeyse döner. */
export function ownLogoPath(url: string | null | undefined, supabaseUrl: string, tenantId: string): string | null {
  if (!url || !isOwnLogoUrl(url, supabaseUrl)) return null;
  const path = decodeURIComponent(url.slice(logoPublicPrefix(supabaseUrl).length));
  const [folder, file, ...rest] = path.split("/");
  if (folder !== tenantId || !file || rest.length > 0 || file.includes("..")) return null;
  return path;
}
