import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { graphVersion } from "./graph";

/**
 * Meta başvuru durum geribeslemesi (docs/spec-meta-geribesleme.md): kuyruktaki olayları Conversions API'ye iletir.
 * Olay üretimi veritabanında (tetikleyiciler); burada yalnız aşama adı eşlemesi ve gönderim var.
 */

export type Signal =
  | "lead"
  | "appointment"
  | "visited"
  | "applied"
  | "approved"
  | "completed"
  | "rejected"
  | "not_interested"
  | "disqualified"
  | "unreachable";

/** Bizdeki sinyal -> Meta aşama adı (Potansiyel Müşteri Merkezi aşamalarıyla aynı). Değişiklik yalnız burada. */
export const STAGE_BY_SIGNAL: Record<Signal, string> = {
  lead: "Giriş",
  appointment: "Uygun",
  visited: "Uygun",
  applied: "Uygun",
  approved: "Uygun",
  completed: "Dönüşüm",
  rejected: "Kayıp",
  not_interested: "Kayıp",
  unreachable: "Kayıp",
  disqualified: "Uygun değil",
};

/** Meta event_time'ı gönderimden en fazla 7 gün eski kabul eder; payı bırakmak için 6,5 gün. */
export const MAX_AGE_MS = 6.5 * 24 * 3600 * 1000;
export const MAX_ATTEMPTS = 5;
const BATCH = 100;
const LIMIT = 500;
/** Test kodu açıkken tek turda en çok bu kadar olay gider (kuyruğu test ile tüketmemek için). */
const TEST_CAP = 10;
const BASE = "https://graph.facebook.com";
const LEAD_ID = /^\d{15,17}$/;

export type FeedbackConfig = {
  datasetId: string;
  token: string;
  leadEventSource?: string;
  testEventCode?: string;
  version?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type FeedbackSummary = {
  sent: number;
  skipped: number;
  failed: number;
  /** Geçici hata nedeniyle sonraki tura kalanlar */
  retry: number;
  /** Yetki ya da yapılandırma sorunu nedeniyle gönderim durdu */
  configError: boolean;
};

/**
 * META_DATASET_ID ve bir belirteç yoksa null (geri bildirim kapalı). Belirteç: META_DATASET_TOKEN (Etkinlik Yöneticisi >
 * Ayarlar > Conversions API > erişim belirteci oluştur); yoksa META_ACCESS_TOKEN (sistem kullanıcısı).
 */
export function feedbackFromEnv(): FeedbackConfig | null {
  const datasetId = process.env.META_DATASET_ID?.trim();
  const token = process.env.META_DATASET_TOKEN?.trim() || process.env.META_ACCESS_TOKEN?.trim();
  if (!datasetId || !token || !/^\d+$/.test(datasetId)) return null;
  return {
    datasetId,
    token,
    leadEventSource: process.env.META_FEEDBACK_SOURCE?.trim() || undefined,
    testEventCode: process.env.META_TEST_EVENT_CODE?.trim() || undefined,
  };
}

type EventRow = { id: string; leadgen_id: string; signal: string; event_time: string; attempts: number };

/**
 * İstek gövdesi. lead_id 15-17 haneli sayıdır ve JS'in güvenli tam sayı sınırını aşabilir; sayı olarak (belgedeki
 * biçim) ama basamak kaybı olmadan yazılır.
 */
export function buildBody(events: { stage: string; time: number; leadId: string }[], cfg: Pick<FeedbackConfig, "leadEventSource" | "testEventCode">): string {
  const data = events.map((e, i) => ({
    event_name: e.stage,
    event_time: e.time,
    action_source: "system_generated",
    user_data: { lead_id: `@@LEAD${i}@@` },
    custom_data: { lead_event_source: cfg.leadEventSource ?? "Ringo", event_source: "crm" },
  }));
  let json = JSON.stringify({ data, ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}) });
  events.forEach((e, i) => {
    json = json.replace(`"@@LEAD${i}@@"`, e.leadId);
  });
  return json;
}

type Outcome = { kind: "ok" } | { kind: "permanent"; text: string } | { kind: "transient"; text: string } | { kind: "config"; text: string };

async function post(url: string, body: string, token: string, fetchImpl: typeof fetch): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return { kind: "transient", text: "Meta'ya bağlanılamadı." };
  }
  if (res.ok) return { kind: "ok" };
  let code: number | null = null;
  try {
    const j = (await res.json()) as { error?: { code?: unknown } };
    if (typeof j?.error?.code === "number") code = j.error.code;
  } catch {
    /* gövde yok */
  }
  const text = `Meta HTTP ${res.status}${code ? `, kod ${code}` : ""}`;
  if (res.status === 401 || res.status === 403 || code === 190 || code === 10 || code === 200) return { kind: "config", text };
  if (res.status === 429 || res.status >= 500 || code === 4 || code === 17 || code === 32) return { kind: "transient", text };
  return { kind: "permanent", text };
}

/** Kuyruktaki bekleyen olayları Meta'ya gönderir. Hata fırlatmaz; sonuç özeti döner. */
export async function flushFeedback(admin: SupabaseClient<Database>, cfg: FeedbackConfig): Promise<FeedbackSummary> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? new Date();
  const url = `${BASE}/${cfg.version ?? graphVersion()}/${encodeURIComponent(cfg.datasetId)}/events`;
  const sum: FeedbackSummary = { sent: 0, skipped: 0, failed: 0, retry: 0, configError: false };
  const table = () => admin.from("meta_feedback_events");

  const mark = async (ids: string[], patch: Database["public"]["Tables"]["meta_feedback_events"]["Update"]) => {
    if (ids.length === 0) return;
    const { error } = await table().update(patch).in("id", ids);
    if (error) console.error("[meta-feedback] durum yazılamadı:", error.code ?? "");
  };

  // Süresi dolan olaylar gönderilmez (Meta 7 günden eskiyi atar)
  const cutoff = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const expired = await table().update({ status: "skipped", last_error: "Süresi doldu" }).eq("status", "pending").lt("event_time", cutoff).select("id");
  sum.skipped += expired.data?.length ?? 0;

  const pending = await table()
    .select("id, leadgen_id, signal, event_time, attempts")
    .eq("status", "pending")
    .order("event_time", { ascending: true })
    .limit(cfg.testEventCode ? TEST_CAP : LIMIT);
  if (pending.error) {
    console.error("[meta-feedback] kuyruk okunamadı:", pending.error.code ?? "");
    return sum;
  }
  const rows = (pending.data ?? []) as EventRow[];
  if (rows.length === 0) return sum;

  // Aynı başvuruya aynı Meta aşaması ikinci kez gönderilmez (ör. randevu ve geldi: tek "Uygun")
  const leadIds = [...new Set(rows.map((r) => r.leadgen_id))];
  const done = await table().select("leadgen_id, signal").eq("status", "sent").in("leadgen_id", leadIds);
  const seen = new Set<string>();
  for (const d of done.data ?? []) {
    const st = STAGE_BY_SIGNAL[d.signal as Signal];
    if (st) seen.add(`${d.leadgen_id}|${st}`);
  }

  const send: { row: EventRow; stage: string }[] = [];
  const skip: string[] = [];
  const bad: string[] = [];
  for (const r of rows) {
    const stage = STAGE_BY_SIGNAL[r.signal as Signal];
    if (!LEAD_ID.test(r.leadgen_id)) {
      bad.push(r.id);
      continue;
    }
    const key = `${r.leadgen_id}|${stage}`;
    if (!stage || seen.has(key)) {
      skip.push(r.id);
      continue;
    }
    seen.add(key);
    send.push({ row: r, stage });
  }
  await mark(skip, { status: "skipped", last_error: "Aynı aşama zaten gönderildi" });
  await mark(bad, { status: "failed", last_error: "Geçersiz başvuru kimliği" });
  sum.skipped += skip.length;
  sum.failed += bad.length;

  const body = (items: typeof send) =>
    buildBody(
      items.map((i) => ({ stage: i.stage, time: Math.floor(new Date(i.row.event_time).getTime() / 1000), leadId: i.row.leadgen_id })),
      cfg,
    );
  const nowIso = now.toISOString();

  const finish = async (items: typeof send, o: Outcome): Promise<"continue" | "stop"> => {
    const ids = items.map((i) => i.row.id);
    if (o.kind === "ok") {
      await mark(ids, { status: "sent", sent_at: nowIso, last_error: cfg.testEventCode ? "test" : null });
      sum.sent += ids.length;
      return "continue";
    }
    if (o.kind === "config") {
      await mark(ids, { last_error: o.text });
      sum.configError = true;
      sum.retry += ids.length;
      return "stop";
    }
    if (o.kind === "permanent") {
      await mark(ids, { status: "failed", last_error: o.text });
      sum.failed += ids.length;
      return "continue";
    }
    // geçici hata: deneme sayısı artar, sınırda başarısız
    for (const i of items) {
      const attempts = i.row.attempts + 1;
      await mark([i.row.id], attempts >= MAX_ATTEMPTS ? { status: "failed", attempts, last_error: o.text } : { attempts, last_error: o.text });
      if (attempts >= MAX_ATTEMPTS) sum.failed++;
      else sum.retry++;
    }
    return "stop";
  };

  for (let i = 0; i < send.length; i += BATCH) {
    const items = send.slice(i, i + BATCH);
    const o = await post(url, body(items), cfg.token, fetchImpl);
    // Toplu istekte tek bozuk olay hepsini düşürür: kalıcı hatada tek tek yeniden denenir
    if (o.kind === "permanent" && items.length > 1) {
      let stop = false;
      for (const one of items) {
        if (stop) break;
        const r = await post(url, body([one]), cfg.token, fetchImpl);
        stop = (await finish([one], r)) === "stop";
      }
      if (stop) break;
      continue;
    }
    if ((await finish(items, o)) === "stop") break;
  }
  return sum;
}
