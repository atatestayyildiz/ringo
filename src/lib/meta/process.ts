import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { safeEqual } from "@/lib/push/auth";
import { describeError, isPermanentGraphError, type Graph } from "./graph";
import { DB_ERROR_TEXT, DbError, ingestLead, recordStatus } from "./ingest";
import { verifySignature } from "./signature";

export type MetaDeps = {
  appSecret: string | undefined;
  verifyToken: string | undefined;
  /** null: META_ACCESS_TOKEN tanımlı değil. */
  graph: Graph | null;
  getAdmin: () => SupabaseClient<Database>;
};

/** GET: Meta abonelik doğrulaması. */
export function processVerifyRequest(req: Request, deps: Pick<MetaDeps, "verifyToken">): Response {
  if (!deps.verifyToken) return new Response("Yapılandırılmadı", { status: 503 });
  const q = new URL(req.url).searchParams;
  const mode = q.get("hub.mode");
  const token = q.get("hub.verify_token");
  const challenge = q.get("hub.challenge");
  if (mode !== "subscribe" || !token || challenge === null || !safeEqual(token, deps.verifyToken)) {
    return new Response("Yasak", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** İmza doğrulamasından önce kabul edilen en büyük gövde (bayt). */
export const MAX_BODY_BYTES = 1_048_576;
export const PERMANENT_LEAD_TEXT = "Bir başvuru Meta'dan okunamadı (silinmiş ya da erişilemiyor), atlandı.";
const tooLarge = () => Response.json({ ok: false }, { status: 413 });

type Change = { field?: string; value?: { leadgen_id?: unknown; page_id?: unknown; form_id?: unknown } };
type Entry = { id?: unknown; changes?: Change[] };

const ID = /^[0-9]{1,40}$/;
const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);

/** POST: imzayı HAM gövdede doğrular, her leadgen değişikliğini işler. */
export async function processWebhookRequest(req: Request, deps: MetaDeps): Promise<Response> {
  if (!deps.appSecret) return Response.json({ ok: false, error: "Meta yapılandırılmadı." }, { status: 503 });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return tooLarge();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), deps.appSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (!deps.graph) return Response.json({ ok: false, error: "Meta yapılandırılmadı." }, { status: 503 });

  let body: { object?: string; entry?: Entry[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (body?.object !== "page" || !Array.isArray(body.entry)) return Response.json({ ok: true });

  const admin = deps.getAdmin();
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  let failed = 0;

  for (const entry of body.entry) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== "leadgen") continue;
      const leadgenId = str(ch.value?.leadgen_id);
      const pageId = str(ch.value?.page_id) ?? str(entry.id);
      if (!leadgenId || !pageId || !ID.test(leadgenId) || !ID.test(pageId)) {
        bump("invalid");
        continue;
      }
      const formRaw = str(ch.value?.form_id);
      const formId = formRaw && ID.test(formRaw) ? formRaw : undefined;

      const tenant = await admin.rpc("meta_tenant_for_page", { p_page_id: pageId });
      if (tenant.error) {
        console.error("[meta] kiracı bulunamadı:", leadgenId, tenant.error.code ?? "");
        failed++;
        continue;
      }
      if (!tenant.data) {
        bump("skipped");
        continue;
      }
      const tenantId = tenant.data;
      try {
        const lead = await deps.graph.lead(leadgenId);
        const result = await ingestLead(admin, tenantId, lead, { leadgenId, formId });
        bump(result);
        await recordStatus(admin, tenantId, true, null);
      } catch (e) {
        if (isPermanentGraphError(e)) {
          // Silinmiş/erişilemeyen başvuru: 500 dönmek Meta'yı sonsuza dek yeniden denetir. Atla, 200 dön.
          console.error("[meta] başvuru atlandı:", leadgenId, e instanceof Error ? e.name : "hata");
          bump("unreadable");
          await recordStatus(admin, tenantId, false, PERMANENT_LEAD_TEXT);
          continue;
        }
        failed++;
        console.error("[meta] başvuru işlenemedi:", leadgenId, e instanceof Error ? e.name : "hata");
        await recordStatus(admin, tenantId, false, e instanceof DbError ? DB_ERROR_TEXT : describeError(e));
      }
    }
  }

  // Geçici hatada 500: Meta yeniden dener, işlem idempotent.
  if (failed > 0) return Response.json({ ok: false, failed, ...counts }, { status: 500 });
  return Response.json({ ok: true, ...counts });
}
