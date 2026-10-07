import type { FieldData } from "./map";

export type GraphLead = { id: string; created_time?: string; form_id?: string; field_data?: FieldData };

/** Hata mesajı anahtar/URL içermez; yalnız HTTP durumu ve Graph hata kodu. */
export class GraphError extends Error {
  readonly status: number;
  readonly code: number | null;
  constructor(status: number, code: number | null) {
    super(status === 0 ? "Graph isteği başarısız (bağlantı)" : `Graph isteği başarısız (HTTP ${status}${code ? `, kod ${code}` : ""})`);
    this.name = "GraphError";
    this.status = status;
    this.code = code;
  }
}

/** Kullanıcıya ve durum alanına yazılabilen Türkçe, sızıntısız açıklama. */
export function describeError(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190 || e.status === 401) return "Meta erişim anahtarı geçersiz veya süresi dolmuş.";
    if (e.code === 10 || e.code === 200 || e.status === 403) return "Meta bu işlem için yetki vermedi. Anahtarın sayfa ve başvuru izinlerini kontrol edin.";
    if (e.status === 429 || e.code === 4 || e.code === 17 || e.code === 32) return "Meta istek sınırına takıldı. Biraz sonra tekrar denenecek.";
    if (e.code === 100 || e.status === 400 || e.status === 404) return "Meta isteği kabul etmedi. Sayfa kimliğini kontrol edin.";
    if (e.status === 0) return "Meta'ya bağlanılamadı.";
    return "Meta geçici olarak yanıt vermedi.";
  }
  return "Beklenmeyen bir hata oluştu.";
}

/** Kalıcı hata: başvuru silinmiş/erişilemiyor; yeniden denemek işe yaramaz (Meta'yı 500 ile yeniden denetme). */
export function isPermanentGraphError(e: unknown): boolean {
  if (!(e instanceof GraphError)) return false;
  if (e.code === 100 || e.status === 404) return true;
  // 400: anahtar (190), istek sınırı ve yetki kodları geçici ya da yapılandırma sorunudur, kalıcı sayılmaz.
  return e.status === 400 && ![190, 4, 10, 17, 32, 200].includes(e.code ?? -1);
}

export type Graph = {
  lead(leadgenId: string): Promise<GraphLead>;
  forms(pageId: string): Promise<string[]>;
  leads(formId: string, sinceSec: number): Promise<GraphLead[]>;
  pageToken(pageId: string): Promise<string>;
  subscribe(pageId: string, pageToken: string): Promise<void>;
};

export const graphVersion = () => process.env.META_GRAPH_VERSION || "v23.0";

const BASE = "https://graph.facebook.com";
const MAX_PAGES = 20;
const LEAD_FIELDS = "id,created_time,form_id,field_data";

export function createGraph(token: string, fetchImpl: typeof fetch = fetch, version: string = graphVersion()): Graph {
  async function call<T>(path: string, opts: { params?: Record<string, string>; method?: "GET" | "POST"; token?: string } = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const qs = method === "GET" && opts.params ? `?${new URLSearchParams(opts.params)}` : "";
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}/${version}/${path}${qs}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token ?? token}`,
          ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: method === "POST" ? new URLSearchParams(opts.params ?? {}).toString() : undefined,
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
    } catch {
      throw new GraphError(0, null);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* gövde yok */
    }
    if (!res.ok) {
      const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
      throw new GraphError(res.status, typeof code === "number" ? code : null);
    }
    return json as T;
  }

  async function paged<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await call<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
        params: { ...params, limit: "100", ...(after ? { after } : {}) },
      });
      out.push(...(page.data ?? []));
      // `paging.next` adresi kullanılmaz (anahtar taşıyabilir); yalnız imleç.
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out;
  }

  return {
    lead: (id) => call<GraphLead>(encodeURIComponent(id), { params: { fields: LEAD_FIELDS } }),
    forms: async (pageId) => (await paged<{ id: string }>(`${encodeURIComponent(pageId)}/leadgen_forms`, { fields: "id" })).map((f) => f.id),
    leads: (formId, sinceSec) =>
      paged<GraphLead>(`${encodeURIComponent(formId)}/leads`, {
        fields: LEAD_FIELDS,
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.max(0, Math.floor(sinceSec)) }]),
      }),
    pageToken: async (pageId) => {
      const r = await call<{ access_token?: string }>(encodeURIComponent(pageId), { params: { fields: "access_token" } });
      if (!r.access_token) throw new GraphError(403, null);
      return r.access_token;
    },
    subscribe: async (pageId, pageToken) => {
      await call(`${encodeURIComponent(pageId)}/subscribed_apps`, { method: "POST", token: pageToken, params: { subscribed_fields: "leadgen" } });
    },
  };
}
