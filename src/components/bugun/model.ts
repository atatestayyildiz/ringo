import type { CallStatus } from "@/components/ui";
import { dayKey } from "@/lib/format";

export type Outcome =
  | "appointment"
  | "callback"
  | "no_answer"
  | "busy"
  | "disqualified"
  | "not_interested"
  | "wrong_number";

export const OUTCOME_VALUES: Outcome[] = [
  "appointment",
  "callback",
  "no_answer",
  "busy",
  "disqualified",
  "not_interested",
  "wrong_number",
];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  appointment: "Dükkana gelecek",
  callback: "Sonra ara",
  no_answer: "Açmadı",
  busy: "Meşgul",
  disqualified: "Uygun değil",
  not_interested: "İlgilenmiyor",
  wrong_number: "Yanlış numara",
};

export const OPERATORS: Record<string, string> = { VF: "Vodafone", TC: "Turkcell", TT: "Türk Telekom" };

export type Tone = "wait" | "retry" | "done" | "bad" | "pool";

export function toneOf(status: CallStatus): Tone {
  switch (status) {
    case "pending":
      return "wait";
    case "retry":
      return "retry";
    case "done":
      return "done";
    case "pool":
      return "pool";
    default:
      return "bad";
  }
}

/** Arama kaydı yalnız bekleyen/tekrar müşteride açıktır (log_call ile aynı kural, DB zorlar). */
export function isCallOpen(status: CallStatus): boolean {
  return status === "pending" || status === "retry";
}

/**
 * Takvim olarak bugünden sonraya ertelenmiş (Sonra ara) tekrar müşterisi.
 * Yalnız görüntüleme gruplaması: vakti gelen gün DB dağıtımı onu listeye geri verir.
 * todayKey = Europe/Istanbul gün anahtarı (YYYY-MM-DD); dayKey ile aynı biçim, sözcük sırası = tarih sırası.
 */
export function isDeferred(
  item: Pick<Item, "status" | "nextCallAt">,
  todayKey: string,
): boolean {
  return item.status === "retry" && dayKey(item.nextCallAt) > todayKey;
}

export type LogEntry ={ outcome: string; note: string | null };

export type Origin = "new" | "pool" | "archive";

export const ORIGIN_ORDER: Origin[] = ["new", "pool", "archive"];

export const ORIGIN_LABEL: Record<Origin, string> = {
  new: "Yeni müşteriler",
  pool: "Havuzdan dönenler",
  archive: "Geçmiş dönem",
};

/**
 * Müşteri listeye nereden geldi. Bugün havuza düşen yeni müşteri pool_count'u bir artırdığı için
 * havuzdaki kayıtta bir eksiği sayılır: yeni müşteri gün içinde "havuzdan dönen"e kaymaz.
 */
export function originOf(c: { archive: boolean; status: CallStatus; poolCount: number }): Origin {
  if (c.archive) return "archive";
  const before = c.status === "pool" ? c.poolCount - 1 : c.poolCount;
  return before > 0 ? "pool" : "new";
}

/** Sırayı kaynağa göre gruplar; grup içinde verilen sıra korunur. Boş grup dönmez. */
export function groupByOrigin<T extends { origin: Origin }>(list: T[]): { origin: Origin; items: T[] }[] {
  return ORIGIN_ORDER.map((origin) => ({ origin, items: list.filter((i) => i.origin === origin) })).filter(
    (g) => g.items.length > 0,
  );
}

export type Item = {
  id: string;
  name: string;
  phone: string;
  operator: string | null;
  /** İkinci telefon (Meta formundaki ek numara), yoksa null */
  phoneAlt: string | null;
  /** Başvurudaki tutar (ham metin; gösterim formatAmount ile), yoksa null */
  amount: string | null;
  /** Geçmiş dönem müşterisi (kapanmış kayıttan alındı); bugünkü form müşterisi sayılmaz */
  archive: boolean;
  /** Listeye nereden geldi: yeni başvuru, havuzdan dönüş ya da geçmiş dönem */
  origin: Origin;
  appliedLabel: string | null;
  status: CallStatus;
  tries: number;
  nextCallAt: string;
  position: number;
  owner: string | null;
  /** Eskiden yeniye */
  log: LogEntry[];
};

export type TeamRow = {
  memberId: string;
  name: string;
  assigned: number;
  done: number;
  appointments: number;
};

export type BirthdayInfo = {
  name: string;
  daysLeft: number;
  dateLabel: string;
  waHref: string | null;
  more: number;
};

export type PoolInfo = { count: number; nearestDays: number | null; thisWeek: number };

export type RuleNumbers = { maxAttempts: number; poolWaitDays: number; maxRounds: number };

export type LogCallResult =
  | { ok: true; status: CallStatus; attempts: number; poolCount: number; nextCallAt: string }
  | { ok: false; error: string };

export type DistributionMode = "auto_even" | "free_pool" | "manual";

/** Serbest havuz kartı: sırada bekleyen, açık müşteri sayısı ve sınır (claim_queue_status). */
export type ClaimInfo = { waiting: number; open: number; limit: number };

export type ClaimResult =
  | { ok: true; id: string; name: string }
  | { ok: true; id: null }
  | { ok: false; error: string };

export type DistributeResult = { ok: true; count: number } | { ok: false; error: string };

export function logText(e: LogEntry): string {
  const label = e.outcome === "note" ? "Not" : (OUTCOME_LABEL[e.outcome as Outcome] ?? e.outcome);
  return e.note ? `${label}: ${e.note}` : label;
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
