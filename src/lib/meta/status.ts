export type MetaStatus = {
  connected: boolean;
  page_id: string | null;
  connected_at: string | null;
  last_lead_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseMetaStatus(raw: unknown): MetaStatus {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    connected: o.connected === true,
    page_id: s(o.page_id),
    connected_at: s(o.connected_at),
    last_lead_at: s(o.last_lead_at),
    last_sync_at: s(o.last_sync_at),
    last_error: s(o.last_error),
    last_error_at: s(o.last_error_at),
  };
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "Henüz yok";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Henüz yok";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
}
