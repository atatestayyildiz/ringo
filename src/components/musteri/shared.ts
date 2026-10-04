import type { Database } from "@/lib/database.types";

export type Customer = Pick<
  Database["public"]["Tables"]["customers"]["Row"],
  | "id"
  | "full_name"
  | "phone"
  | "phone_alt"
  | "operator"
  | "birth_date"
  | "call_status"
  | "pipeline_stage"
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
  "id, full_name, phone, phone_alt, operator, birth_date, call_status, pipeline_stage, assigned_to, last_note, last_outcome, source, source_detail, applied_at, attempts_in_round, pool_count, next_call_at, created_at";

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
