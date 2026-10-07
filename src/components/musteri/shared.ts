import type { Database } from "@/lib/database.types";

export type Customer = Pick<
  Database["public"]["Tables"]["customers"]["Row"],
  | "id"
  | "full_name"
  | "phone"
  | "phone_alt"
  | "operator"
  | "amount"
  | "birth_date"
  | "call_status"
  | "pipeline_stage"
  | "appointment_day"
  | "appointment_time"
  | "assigned_to"
  | "last_note"
  | "last_outcome"
  | "source"
  | "source_detail"
  | "applied_at"
  | "attempts_in_round"
  | "pool_count"
  | "next_call_at"
  | "created_at"
>;

export const CUSTOMER_COLUMNS =
  "id, full_name, phone, phone_alt, operator, amount, birth_date, call_status, pipeline_stage, appointment_day, appointment_time, assigned_to, last_note, last_outcome, source, source_detail, applied_at, attempts_in_round, pool_count, next_call_at, created_at";

export type MemberLite = { id: string; full_name: string; is_active: boolean };

/** Arayüzde düğme göstermek için; asıl koruma RLS ve RPC'dedir. */
export type Viewer = {
  id: string;
  isManager: boolean;
  canImport: boolean;
  canReassign: boolean;
  canDelete: boolean;
};

export const STAGE_LABEL: Record<string, string> = {
  appointment: "Dükkana gelecek",
  visited: "Geldi",
  applied: "Başvuru",
  approved: "Onaylandı",
  completed: "İşlem tamam",
  rejected: "Reddedildi",
  not_interested: "İlgilenmiyor",
};

export const MAIN_STAGES = ["appointment", "visited", "applied", "approved", "completed"] as const;
export const SIDE_STAGES = ["rejected", "not_interested"] as const;
export const ALL_STAGES = [...MAIN_STAGES, ...SIDE_STAGES] as const;

/** Meta ve içe aktarma notları " · " ile birleşir; okunabilir satırlara böler. */
export function noteLines(note: string | null | undefined): string[] {
  return (note ?? "")
    .split(" · ")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Tutar sayısal aralıksa ("100-200") "100-200 bin ₺", zaten ₺ içeriyorsa düzenli yazar, diğerlerinde olduğu gibi. */
export function formatAmount(raw: string | null | undefined): { value: string; unit: string } | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = v.match(/^(\d+)\s*[-–]\s*(\d+)\s*(?:bin)?\s*₺?$/i);
  if (m) return { value: `${m[1]}-${m[2]}`, unit: "bin ₺" };
  const k = v.match(/^(\d+)\s*[-–]\s*(\d+)\s*bin\s*₺$/i);
  if (k) return { value: `${k[1]}-${k[2]}`, unit: "bin ₺" };
  const one = v.match(/^(\d+)\s*(?:bin)?\s*₺?$/i);
  if (one) return { value: one[1], unit: "bin ₺" };
  return { value: v, unit: v.includes("₺") ? "" : "₺" };
}

export const OPERATOR_LABEL: Record<string, string> = {
  VF: "Vodafone",
  TC: "Turkcell",
  TT: "Türk Telekom",
};

export const OUTCOME_LABEL: Record<string, string> = {
  appointment: "Dükkana gelecek",
  callback: "Sonra ara",
  no_answer: "Açmadı",
  busy: "Meşgul",
  disqualified: "Uygun değil",
  not_interested: "İlgilenmiyor",
  wrong_number: "Yanlış numara",
};

export function memberName(members: MemberLite[], id: string | null): string {
  if (!id) return "";
  return members.find((m) => m.id === id)?.full_name ?? "";
}
