import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { bearerToken, safeEqual } from "@/lib/push/auth";
import { describeError, type Graph } from "./graph";
import { DB_ERROR_TEXT, DbError, ingestLead, questionTypes, recordStatus } from "./ingest";

export type Connection = { tenant_id: string; page_id: string; last_sync_at: string | null };

export type SyncSummary = {
  connections: number;
  failed: number;
  leads: number;
  inserted: number;
  reopened: number;
  duplicate: number;
  invalid: number;
  seen: number;
};

const OVERLAP_MS = 30 * 60 * 1000;
const FIRST_MS = 24 * 3600 * 1000;

/** `?hours=N` -> 1-168 tam sayı; yoksa ya da sayı değilse undefined, aralık dışı sıkıştırılır. */
export function parseHours(v: string | null): number | undefined {
  if (v === null || !/^\d+$/.test(v.trim())) return undefined;
  return Math.min(168, Math.max(1, Number(v)));
}

/** Taramanın başlangıcı (Unix saniye). */
export function sinceFor(conn: Connection, now: Date, hours?: number): number {
  let ms: number;
  const last = conn.last_sync_at ? new Date(conn.last_sync_at).getTime() : NaN;
  if (hours) ms = now.getTime() - hours * 3600 * 1000;
  else if (!Number.isNaN(last)) ms = last - OVERLAP_MS;
  else ms = now.getTime() - FIRST_MS;
  return Math.floor(ms / 1000);
}

export async function syncConnections(
  admin: SupabaseClient<Database>,
  graph: Graph,
  conns: Connection[],
  opts: { now?: Date; hours?: number } = {},
): Promise<SyncSummary> {
  const now = opts.now ?? new Date();
  const sum: SyncSummary = { connections: conns.length, failed: 0, leads: 0, inserted: 0, reopened: 0, duplicate: 0, invalid: 0, seen: 0 };
  for (const c of conns) {
    try {
      const since = sinceFor(c, now, opts.hours);
      const forms = await graph.forms(c.page_id);
      for (const formId of forms) {
        const leads = await graph.leads(formId, since, c.page_id);
        const types = await questionTypes(graph, formId, c.page_id);
        for (const lead of leads) {
          const r = await ingestLead(admin, c.tenant_id, lead, { formId }, types);
          sum.leads++;
          sum[r]++;
        }
      }
      await recordStatus(admin, c.tenant_id, true, null, true);
    } catch (e) {
      sum.failed++;
      console.error("[meta-sync] tarama başarısız:", e instanceof Error ? e.name : "hata");
      await recordStatus(admin, c.tenant_id, false, e instanceof DbError ? DB_ERROR_TEXT : describeError(e));
    }
  }
  return sum;
}

export type SyncDeps = {
  secret: string | undefined;
  graph: Graph | null;
  getAdmin: () => SupabaseClient<Database>;
  now?: Date;
};

export async function processSyncRequest(req: Request, deps: SyncDeps): Promise<Response> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return Response.json({ ok: false }, { status: 401 });
  if (!deps.secret) return Response.json({ ok: false, error: "Zamanlayıcı sırrı yapılandırılmadı." }, { status: 503 });
  if (!safeEqual(token, deps.secret)) return Response.json({ ok: false }, { status: 401 });
  if (!deps.graph) return Response.json({ ok: false, error: "Meta yapılandırılmadı." }, { status: 503 });

  const admin = deps.getAdmin();
  const list = await admin.rpc("meta_connections_list");
  if (list.error) {
    console.error("[meta-sync] bağlantılar okunamadı:", list.error.code ?? "");
    return Response.json({ ok: false, error: "Bağlantılar okunamadı." }, { status: 500 });
  }
  const hours = parseHours(new URL(req.url).searchParams.get("hours"));
  const sum = await syncConnections(admin, deps.graph, list.data ?? [], { now: deps.now, hours });
  return Response.json({ ok: sum.failed === 0, ...sum }, { status: sum.failed > 0 ? 500 : 200 });
}
