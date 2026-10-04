/** Ayarlar ekranının istemci ve sunucu tarafında ortak, saf yardımcıları. */

export type RulesValues = {
  max_attempts: number;
  pool_wait_days: number;
  max_rounds: number;
  distribution_hour: number;
  summary_hour: number;
  birthday_notice_days: number;
  distribution_mode: "auto_even" | "free_pool" | "manual";
};

export const RULE_LIMITS: Record<Exclude<keyof RulesValues, "distribution_mode">, [number, number, string]> = {
  max_attempts: [1, 10, "Deneme sayısı"],
  pool_wait_days: [1, 60, "Havuz bekleme günü"],
  max_rounds: [0, 10, "Havuza düşme sayısı"],
  distribution_hour: [0, 23, "Dağıtım saati"],
  summary_hour: [0, 23, "Özet saati"],
  birthday_notice_days: [0, 30, "Doğum günü uyarısı"],
};

/** Hata varsa Türkçe mesaj, yoksa null. */
export function checkRule(key: keyof typeof RULE_LIMITS, n: number): string | null {
  const [min, max, name] = RULE_LIMITS[key];
  if (!Number.isInteger(n) || n < min || n > max) return `${name} ${min} ile ${max} arasında bir tam sayı olmalı.`;
  return null;
}

/** rules_summary_text() ile aynı cümle kalıbı (canlı önizleme). */
export function rulesSummary(v: Pick<RulesValues, "max_attempts" | "pool_wait_days" | "max_rounds">): string {
  return `Ulaşılamayan müşteri aynı gün tekrar aranır. ${v.max_attempts} başarısız denemeden sonra havuza düşer ve ${v.pool_wait_days} gün sonra listeye geri çıkar. Havuza en fazla ${v.max_rounds} kez düşer, sonra 'ulaşılamadı' olarak kapanır.`;
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const BRAND_SWATCHES = ["#FF5E2B", "#3D7BFF", "#8B5CF6", "#16A765", "#E5484D", "#F59E0B", "#0EA5A0", "#EC4899"];

export const PERMISSIONS: { key: PermKey; label: string; desc: string }[] = [
  { key: "view_all_customers", label: "Tüm müşterileri görsün", desc: "Kendine atanmayanlar dahil tüm listeyi okur, değiştiremez." },
  { key: "import_customers", label: "Müşteri eklesin", desc: "Tek tek ekler ve Excel ile toplu içe aktarır." },
  { key: "reassign", label: "Devredebilsin", desc: "Müşteriyi başka çalışana aktarır." },
  { key: "export", label: "Dışa aktarabilsin", desc: "Müşteri listesini dosya olarak indirir." },
  { key: "view_reports", label: "Raporları görsün", desc: "Yönetim ekranındaki ekip ve özet kartlarını açar." },
  { key: "delete_customers", label: "Müşteri silebilsin", desc: "Müşteriyi kalıcı siler (KVKK silme talebi)." },
];

export type PermKey =
  | "view_all_customers"
  | "import_customers"
  | "reassign"
  | "export"
  | "view_reports"
  | "delete_customers";

export const PERM_KEYS = PERMISSIONS.map((p) => p.key);

export type MemberRow = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: "manager" | "agent";
  is_active: boolean;
  permissions: Partial<Record<PermKey, boolean>>;
  isSelf: boolean;
};

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return `${out}9`;
}
