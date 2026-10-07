/** report_range / report_range_member JSON yapısı (supabase/migrations/20261005000100_reached_distinct.sql). */
export type ReportTotals = {
  attempts: number;
  customers_called: number;
  reached: number;
  appointments: number;
  visited: number;
  applied: number;
  approved: number;
  completed: number;
  rejected: number;
  not_interested: number;
  disqualified: number;
  pooled: number;
  unreachable: number;
  new_customers: number;
  /** Aralıktaki günlük atama satırı (çalışan x gün). */
  assigned: number;
};

/** report_intake JSON yapısı (supabase/migrations/20261007000600_report_intake.sql). */
export type Intake = {
  received: number;
  looked_at: number;
  waiting: number;
  waiting_now: number;
  waiting_now_unassigned: number;
};

export function normalizeIntake(data: unknown): Intake | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  return {
    received: n("received"),
    looked_at: n("looked_at"),
    waiting: n("waiting"),
    waiting_now: n("waiting_now"),
    waiting_now_unassigned: n("waiting_now_unassigned"),
  };
}

/** team: kiracı geneli (yönetici veya view_reports); member: tek çalışan. Kapsamı DB belirler. */
export type ReportScope = "team" | "member";

export type Report = {
  scope: ReportScope;
  member_id: string | null;
  totals: ReportTotals;
  rates: { reach_rate: number; appointment_rate: number; visit_rate: number; close_rate: number };
  by_member: { member_id: string; full_name: string; attempts: number; customers_called: number; reached: number; appointments: number; completed: number }[];
  by_day: { day: string; attempts: number; reached: number; appointments: number }[];
  by_outcome: { outcome: string; count: number }[];
  by_source: { source_detail: string; customers: number; appointments: number; completed: number }[];
  by_operator: { operator: string; customers: number; completed: number }[];
};

export const OPERATOR_NAME: Record<string, string> = {
  VF: "Vodafone",
  TC: "Turkcell",
  TT: "Türk Telekom",
};

export const OUTCOME_NAME: Record<string, string> = {
  appointment: "Dükkana gelecek",
  callback: "Sonra ara",
  no_answer: "Açmadı",
  busy: "Meşgul",
  disqualified: "Uygun değil",
  not_interested: "İlgilenmiyor",
  wrong_number: "Yanlış numara",
};

/** 0.4132 -> "%41,3" (tam sayıysa ondalıksız). */
export function pct(rate: number): string {
  const v = Math.round(rate * 1000) / 10;
  return `%${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

/** Oran: pay/payda, payda 0 ise 0. */
export function ratio(n: number, d: number): number {
  return d > 0 ? Math.min(1, n / d) : 0;
}

export function isEmptyReport(r: Report): boolean {
  const t = r.totals;
  return t.attempts === 0 && t.visited === 0 && t.applied === 0 && t.approved === 0 && t.completed === 0 && t.new_customers === 0 && t.assigned === 0;
}

/** Dönen Json'u güvenli biçimde Report'a çevirir; eksik alanlar boş/0. */
export function normalizeReport(raw: unknown): Report {
  const o = (raw ?? {}) as Partial<Report>;
  const t = (o.totals ?? {}) as Partial<ReportTotals>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    // Bilinmeyen kapsam ekip sayılmaz: dar görünüm güvenli taraf
    scope: o.scope === "team" ? "team" : "member",
    member_id: typeof o.member_id === "string" ? o.member_id : null,
    totals: {
      attempts: n(t.attempts),
      customers_called: n(t.customers_called),
      reached: n(t.reached),
      appointments: n(t.appointments),
      visited: n(t.visited),
      applied: n(t.applied),
      approved: n(t.approved),
      completed: n(t.completed),
      rejected: n(t.rejected),
      not_interested: n(t.not_interested),
      disqualified: n(t.disqualified),
      pooled: n(t.pooled),
      unreachable: n(t.unreachable),
      new_customers: n(t.new_customers),
      assigned: n(t.assigned),
    },
    rates: {
      reach_rate: n(o.rates?.reach_rate),
      appointment_rate: n(o.rates?.appointment_rate),
      visit_rate: n(o.rates?.visit_rate),
      close_rate: n(o.rates?.close_rate),
    },
    by_member: o.by_member ?? [],
    by_day: o.by_day ?? [],
    by_outcome: o.by_outcome ?? [],
    by_source: o.by_source ?? [],
    by_operator: o.by_operator ?? [],
  };
}
