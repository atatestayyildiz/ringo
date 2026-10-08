import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBody, feedbackFromEnv, flushFeedback, MAX_ATTEMPTS, STAGE_BY_SIGNAL } from "./feedback";

type Row = { id: string; leadgen_id: string; signal: string; event_time: string; attempts: number; status: string; last_error: string | null; sent_at: string | null };
type Filter = [kind: "eq" | "lt" | "in", col: string, val: unknown];

/** Kuyruk tablosunu bellekte taklit eden minimal Supabase istemcisi (yalnız feedback.ts'in kullandığı çağrılar). */
function fakeAdmin(rows: Row[]) {
  const from = () => {
    let mode: "select" | "update" = "select";
    let patch: Partial<Row> = {};
    let wantRows = false;
    let max = Infinity;
    const filters: Filter[] = [];
    let orderBy: string | null = null;
    const match = () =>
      rows.filter((r) =>
        filters.every(([k, col, v]) => {
          const x = (r as unknown as Record<string, unknown>)[col];
          if (k === "eq") return x === v;
          if (k === "lt") return String(x) < String(v);
          return (v as unknown[]).includes(x);
        }),
      );
    const run = () => {
      let hit = match();
      if (orderBy) hit = [...hit].sort((a, b) => String((a as never)[orderBy as never]).localeCompare(String((b as never)[orderBy as never])));
      hit = hit.slice(0, max);
      if (mode === "update") {
        for (const r of hit) Object.assign(r, patch);
        return { data: wantRows ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => {
        if (mode === "update") wantRows = true;
        return b;
      },
      update: (p: Partial<Row>) => {
        mode = "update";
        patch = p;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), b),
      lt: (c: string, v: unknown) => (filters.push(["lt", c, v]), b),
      in: (c: string, v: unknown[]) => (filters.push(["in", c, v]), b),
      order: (c: string) => ((orderBy = c), b),
      limit: (n: number) => ((max = n), b),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  return { from } as never;
}

const T0 = new Date("2026-10-08T12:00:00Z");
const iso = (minAgo: number) => new Date(T0.getTime() - minAgo * 60_000).toISOString();
const row = (id: string, lead: string, signal: string, minAgo = 5, extra: Partial<Row> = {}): Row => ({
  id,
  leadgen_id: lead,
  signal,
  event_time: iso(minAgo),
  attempts: 0,
  status: "pending",
  last_error: null,
  sent_at: null,
  ...extra,
});
const LEAD_A = "123456789012345678".slice(0, 16); // 16 hane, JS güvenli tam sayıyı aşabilir
const LEAD_B = "223456789012345";

const ok = () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
const fail = (status: number, code?: number) => new Response(JSON.stringify({ error: code ? { code } : {} }), { status });
const cfg = (fetchImpl: typeof fetch) => ({ datasetId: "999", token: "tok", now: T0, version: "v23.0", fetchImpl });

describe("eşleme ve gövde", () => {
  it("her sinyalin Meta aşaması tanımlı", () => {
    expect(STAGE_BY_SIGNAL.lead).toBe("Giriş");
    expect(STAGE_BY_SIGNAL.appointment).toBe("Uygun");
    expect(STAGE_BY_SIGNAL.visited).toBe("Uygun");
    expect(STAGE_BY_SIGNAL.completed).toBe("Dönüşüm");
    expect(STAGE_BY_SIGNAL.not_interested).toBe("Kayıp");
    expect(STAGE_BY_SIGNAL.unreachable).toBe("Kayıp");
    expect(STAGE_BY_SIGNAL.disqualified).toBe("Uygun değil");
  });

  it("lead_id basamak kaybı olmadan sayı olarak yazılır", () => {
    const body = buildBody([{ stage: "Uygun", time: 1700000000, leadId: LEAD_A }], {});
    expect(body).toContain(`"lead_id":${LEAD_A}`);
    const parsed = JSON.parse(body.replace(LEAD_A, "1"));
    expect(parsed.data[0]).toMatchObject({
      event_name: "Uygun",
      event_time: 1700000000,
      action_source: "system_generated",
      custom_data: { lead_event_source: "Ringo", event_source: "crm" },
    });
    expect(parsed.test_event_code).toBeUndefined();
  });

  it("test kodu ve kaynak adı gövdeye girer, telefon/e-posta hiç yok", () => {
    const body = buildBody([{ stage: "Giriş", time: 1, leadId: LEAD_B }], { testEventCode: "TEST123", leadEventSource: "Mağaza" });
    expect(body).toContain('"test_event_code":"TEST123"');
    expect(body).toContain('"lead_event_source":"Mağaza"');
    expect(body).not.toMatch(/phone|email|"em"|"ph"/);
  });

  it("META_DATASET_ID ya da token yoksa kapalı", () => {
    vi.stubEnv("META_DATASET_ID", "");
    vi.stubEnv("META_ACCESS_TOKEN", "t");
    expect(feedbackFromEnv()).toBeNull();
    vi.stubEnv("META_DATASET_ID", "abc");
    expect(feedbackFromEnv()).toBeNull();
    vi.stubEnv("META_DATASET_ID", "12345");
    expect(feedbackFromEnv()).toMatchObject({ datasetId: "12345", token: "t" });
    vi.stubEnv("META_DATASET_TOKEN", "dt");
    expect(feedbackFromEnv()).toMatchObject({ token: "dt" });
    vi.stubEnv("META_DATASET_TOKEN", "");
    vi.stubEnv("META_ACCESS_TOKEN", "");
    expect(feedbackFromEnv()).toBeNull();
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("flushFeedback", () => {
  it("olayları sırayla tek istekte gönderir ve sent işaretler", async () => {
    const rows = [row("1", LEAD_B, "lead", 30), row("2", LEAD_B, "appointment", 10)];
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum).toMatchObject({ sent: 2, skipped: 0, failed: 0, retry: 0, configError: false });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/999/events");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const names = (JSON.parse(String(init.body).replace(LEAD_B, "1")) as { data: { event_name: string }[] }).data.map((d) => d.event_name);
    expect(names).toEqual(["Giriş", "Uygun"]);
    expect(rows.every((r) => r.status === "sent" && r.sent_at === T0.toISOString())).toBe(true);
  });

  it("aynı başvuruya aynı Meta aşaması iki kez gitmez (randevu + geldi = tek Uygun)", async () => {
    const rows = [row("1", LEAD_B, "appointment", 20), row("2", LEAD_B, "visited", 10), row("3", LEAD_B, "completed", 5)];
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.sent).toBe(2);
    expect(sum.skipped).toBe(1);
    expect(rows[1].status).toBe("skipped");
  });

  it("daha önce gönderilmiş aşama tekrar gönderilmez", async () => {
    const rows = [row("1", LEAD_B, "appointment", 60, { status: "sent" }), row("2", LEAD_B, "applied", 5)];
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.skipped).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("6,5 günden eski olay gönderilmez", async () => {
    const rows = [row("1", LEAD_B, "lead", 7 * 24 * 60)];
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.skipped).toBe(1);
    expect(f).not.toHaveBeenCalled();
    expect(rows[0].last_error).toBe("Süresi doldu");
  });

  it("geçersiz başvuru kimliği başarısız sayılır, istek atılmaz", async () => {
    const rows = [row("1", "12ab", "lead")];
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.failed).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("toplu istek 400 verirse tek tek denenir; bozuk olay failed, diğerleri sent", async () => {
    const rows = [row("1", LEAD_B, "lead", 30), row("2", "323456789012345", "lead", 20), row("3", "423456789012345", "lead", 10)];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const body = String(init.body);
      const n = (body.match(/event_name/g) ?? []).length;
      if (n > 1 || body.includes("323456789012345")) return fail(400, 100);
      return ok();
    });
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum).toMatchObject({ sent: 2, failed: 1 });
    expect(rows.map((r) => r.status)).toEqual(["sent", "failed", "sent"]);
    expect(rows[1].last_error).toBe("Meta HTTP 400, kod 100");
  });

  it("geçici hatada olay beklemede kalır, deneme artar; sınırda failed", async () => {
    const rows = [row("1", LEAD_B, "lead")];
    const f = vi.fn(async () => fail(500));
    let sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum).toMatchObject({ sent: 0, retry: 1 });
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1 });
    rows[0].attempts = MAX_ATTEMPTS - 1;
    sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
  });

  it("yetki hatasında (190) gönderim durur, olaylar beklemede kalır, configError işaretlenir", async () => {
    const rows = [row("1", LEAD_B, "lead")];
    const f = vi.fn(async () => fail(400, 190));
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.configError).toBe(true);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0, last_error: "Meta HTTP 400, kod 190" });
  });

  it("ağ hatasında hata fırlatmaz, olay beklemede kalır", async () => {
    const rows = [row("1", LEAD_B, "lead")];
    const f = vi.fn(async () => {
      throw new Error("ağ");
    });
    const sum = await flushFeedback(fakeAdmin(rows), cfg(f as never));
    expect(sum.retry).toBe(1);
    expect(rows[0].status).toBe("pending");
  });

  it("test kodu açıkken en çok 10 olay gider ve sent+test işaretlenir", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(String(i), String(100000000000000 + i), "lead", 30 - i));
    const f = vi.fn(async () => ok());
    const sum = await flushFeedback(fakeAdmin(rows), { ...cfg(f as never), testEventCode: "TEST1" });
    expect(sum.sent).toBe(10);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(5);
    expect(rows[0].last_error).toBe("test");
  });
});
