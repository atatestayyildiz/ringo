import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { GraphLead } from "./graph";
import { mapLead } from "./map";

export type IngestResult = "inserted" | "reopened" | "duplicate" | "invalid" | "seen";

export class DbError extends Error {
  constructor() {
    super("Veritabanı işlemi başarısız");
    this.name = "DbError";
  }
}

export const DB_ERROR_TEXT = "Başvuru kaydedilemedi.";

function isoOrNull(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Tek Graph başvurusunu `ingest_meta_lead` ile ekler (idempotent). Kişisel veri loga yazılmaz. */
export async function ingestLead(
  admin: SupabaseClient<Database>,
  tenantId: string,
  lead: GraphLead,
  fallback: { leadgenId?: string; formId?: string } = {},
): Promise<IngestResult> {
  const leadgenId = lead.id || fallback.leadgenId;
  if (!leadgenId) throw new DbError();
  const formId = lead.form_id || fallback.formId || null;
  const m = mapLead(lead.field_data);
  const { data, error } = await admin.rpc("ingest_meta_lead", {
    p_tenant: tenantId,
    p_leadgen_id: leadgenId,
    p_form_id: formId,
    p_created_time: isoOrNull(lead.created_time),
    p_full_name: m.fullName,
    p_phone: m.phone,
    p_note: m.note,
    p_source_detail: formId ? `Meta form ${formId}` : "Meta form",
  });
  if (error) {
    console.error("[meta] ingest başarısız:", leadgenId, error.code ?? "");
    throw new DbError();
  }
  const r = (data as { result?: string } | null)?.result;
  return r === "inserted" || r === "reopened" || r === "duplicate" || r === "invalid" || r === "seen" ? r : "invalid";
}

/** Durum kaydı; başarısız olması akışı bozmaz. */
export async function recordStatus(
  admin: SupabaseClient<Database>,
  tenantId: string,
  ok: boolean,
  error: string | null,
  synced = false,
): Promise<void> {
  const { error: e } = await admin.rpc("meta_record_status", { p_tenant: tenantId, p_ok: ok, p_error: error, p_synced: synced });
  if (e) console.error("[meta] durum yazılamadı:", e.code ?? "");
}
