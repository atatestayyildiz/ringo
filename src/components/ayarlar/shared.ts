/** Ayarlar ekranının istemci ve sunucu tarafında ortak, saf yardımcıları. */

export type RulesValues = {
  max_attempts: number;
  pool_wait_days: number;
  max_rounds: number;
  birthday_notice_days: number;
  claim_limit: number;
  distribution_mode: "auto_even" | "free_pool" | "manual";
};

export const RULE_LIMITS: Record<Exclude<keyof RulesValues, "distribution_mode">, [number, number, string]> = {
  max_attempts: [1, 10, "Deneme sayısı"],
  pool_wait_days: [1, 60, "Havuz bekleme günü"],
  max_rounds: [0, 10, "Havuza düşme sayısı"],
  birthday_notice_days: [0, 30, "Doğum günü uyarısı"],
  claim_limit: [1, 50, "Açık müşteri sınırı"],
};

export type DistributionMode = RulesValues["distribution_mode"];

export const DISTRIBUTION_MODES: DistributionMode[] = ["auto_even", "free_pool", "manual"];

export const MODE_LABEL: Record<DistributionMode, string> = {
  auto_even: "Otomatik eşit dağıtım",
  free_pool: "Serbest havuz",
  manual: "Elle dağıtım",
};

/** Dağıtım yönteminin sade Türkçe açıklaması (canlı önizleme). */
export function modeSummary(mode: DistributionMode, claimLimit: number): string {
  const keep = "Tekrar aranacak müşteri her zaman onu arayan çalışanın listesinde kalır.";
  switch (mode) {
    case "auto_even":
      return `Her sabah dağıtım saatinde bekleyen yeni müşteriler çalışanlara eşit bölünür. ${keep}`;
    case "free_pool":
      return `Sabah dağıtım yapılmaz. Çalışan Bugün ekranında "Sıradaki müşteriyi al" der, sistem en eski bekleyen müşteriyi verir; kimse listeden seçemez. Bir çalışanın aynı anda en fazla ${claimLimit} açık müşterisi olur. Havuzdan dönen müşteri sıraya girer. ${keep}`;
    case "manual":
      return `Sabah yeni müşteri dağıtılmaz. Yönetici Müşteriler ekranından seçip çalışana atar, atanan müşteri o çalışanın bugünkü listesine düşer. Havuzdan dönen müşteri atanmayı bekler. ${keep}`;
  }
}

/** Hata varsa Türkçe mesaj, yoksa null. */
export function checkRule(key: keyof typeof RULE_LIMITS, n: number): string | null {
  const [min, max, name] = RULE_LIMITS[key];
  if (!Number.isInteger(n) || n < min || n > max) return `${name} ${min} ile ${max} arasında bir tam sayı olmalı.`;
  return null;
}

/** Gönderim saati (0-23 tam sayı) doğrulaması; hata varsa Türkçe mesaj, yoksa null. */
export function checkHour(n: number, name: string): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 23) return `${name} 0 ile 23 arasında bir tam sayı olmalı.`;
  return null;
}

export function checkMinute(n: number, name: string): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 59) return `${name} dakikası 0 ile 59 arasında bir tam sayı olmalı.`;
  return null;
}

/** 24 saat "SS:DD" biçimi (örn. 08:00). */
export function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Yazılan metni "SS:DD" maskesine sokar: yalnız rakam, iki rakamdan sonra iki nokta, en çok 4 rakam. */
export function maskHm(raw: string): string {
  if (/^\d{1,2}:\d{0,2}$/.test(raw)) return raw;
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/** "SS:DD" metnini saat ve dakikaya çevirir; geçersizse null. */
export function parseHm(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
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
  {
    key: "view_reports",
    label: "Ekibin raporlarını görsün",
    desc: "Raporlar sayfasında tüm ekibin toplamlarını görür, müşteri listesi açmaz. Kapalıysa yalnız kendi sonuçlarını görür.",
  },
  { key: "view_team", label: "Yönetim ekranını görsün", desc: "Ekip özet kartları, kim ne yaptı ve havuz durumu." },
  { key: "delete_customers", label: "Müşteri silebilsin", desc: "Müşteriyi kalıcı siler (KVKK silme talebi)." },
];

export type PermKey =
  | "view_all_customers"
  | "import_customers"
  | "reassign"
  | "export"
  | "view_reports"
  | "view_team"
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
