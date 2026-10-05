/** Küçük sınıf birleştirici: boş, false ve undefined değerleri atlar. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
