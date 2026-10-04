/**
 * Yetki ve menü görünürlüğü (saf; sunucu ve testlerde ortak).
 * Asıl kural veritabanında: report_range kapsamı, day_summary, RLS. Buradaki koşullar yalnız
 * hangi menünün ve sayfanın açılacağını belirler, veriyi genişletmez.
 */
import type { NavKey } from "@/components/shell/MainNav";

export type Permission =
  | "view_all_customers"
  | "import_customers"
  | "reassign"
  | "export"
  | "view_reports"
  | "view_team"
  | "delete_customers";

export type AccessMember = { role: string; permissions: unknown };

/** manager her zaman true; agent için permissions jsonb anahtarı (varsayılan false). */
export function can(member: AccessMember, perm: Permission): boolean {
  if (member.role === "manager") return true;
  const p = member.permissions as Record<string, unknown> | null;
  return p?.[perm] === true;
}

/** Yönetim ekranı: yönetici veya view_team. */
export function canViewTeam(member: AccessMember): boolean {
  return can(member, "view_team");
}

/** Raporlarda ekip geneli kapsam: yönetici veya view_reports (DB report_range ile aynı kural). */
export function canViewTeamReports(member: AccessMember): boolean {
  return can(member, "view_reports");
}

/** Rapor CSV'si (her zaman ekip geneli): export ve view_reports birlikte. */
export function canExportReport(member: AccessMember): boolean {
  return can(member, "export") && can(member, "view_reports");
}

/** Ana menü: Raporlar herkese, Yönetim yönetici veya view_team, Ayarlar yalnız yönetici. */
export function navKeys(member: AccessMember): NavKey[] {
  const keys: NavKey[] = ["bugun", "musteriler", "havuz", "huni", "raporlar"];
  if (canViewTeam(member)) keys.push("yonetim");
  if (member.role === "manager") keys.push("ayarlar");
  return keys;
}
