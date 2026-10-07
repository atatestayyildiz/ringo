import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GraphError, type Graph } from "./graph";
import { PERMANENT_LEAD_TEXT, processVerifyRequest, processWebhookRequest } from "./process";

const SECRET = "app-secret-xyz";
const TOKEN = "verify-token-abc";
const ACCESS = "ACCESS-TOKEN-SECRET";

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    object: "page",
    entry: [{ id: "111222333", changes: [{ field: "leadgen", value: { leadgen_id: "9001", page_id: "111222333", form_id: "5005", created_time: 1760000000, ...over } }] }],
  });
const sign = (b: string) => `sha256=${createHmac("sha256", SECRET).update(b).digest("hex")}`;
const post = (b: string, sig?: string) =>
  new Request("http://x/api/meta/webhook", { method: "POST", body: b, headers: sig ? { "x-hub-signature-256": sig } : {} });

const lead = {
  id: "9001",
  created_time: "2026-10-07T10:00:00+0000",
  form_id: "5005",
  field_data: [
    { name: "full_name", values: ["Deniz Örnek"] },
    { name: "phone_number", values: ["p:+905550000000"] },
  ],
};

function fake(opts: { tenant?: string | null; ingest?: { result: string }; ingestError?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "meta_tenant_for_page") return { data: opts.tenant === undefined ? "t1" : opts.tenant, error: null };
      if (fn === "ingest_meta_lead") {
        return opts.ingestError
          ? { data: null, error: { code: "XX000", message: "ham db hatası +905550000000" } }
          : { data: opts.ingest ?? { result: "inserted", customer_id: "c1" }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { calls, getAdmin: () => admin as never };
}
const graphOk = (): Graph => ({ lead: vi.fn().mockResolvedValue(lead) }) as unknown as Graph;
const deps = (f: ReturnType<typeof fake>, graph: Graph | null = graphOk()) => ({ appSecret: SECRET, verifyToken: TOKEN, graph, getAdmin: f.getAdmin });

describe("webhook GET doğrulaması", () => {
  const get = (qs: string) => new Request(`http://x/api/meta/webhook?${qs}`);
  it("doğru token challenge değerini düz metin döner", async () => {
    const r = processVerifyRequest(get(`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=777`), { verifyToken: TOKEN });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("777");
    expect(r.headers.get("content-type")).toContain("text/plain");
  });
  it("yanlış ya da eksik token/mod 403; sır tanımsızsa 503", () => {
    expect(processVerifyRequest(get("hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=1"), { verifyToken: TOKEN }).status).toBe(403);
    expect(processVerifyRequest(get("hub.mode=subscribe&hub.challenge=1"), { verifyToken: TOKEN }).status).toBe(403);
    expect(processVerifyRequest(get(`hub.mode=unsubscribe&hub.verify_token=${TOKEN}&hub.challenge=1`), { verifyToken: TOKEN }).status).toBe(403);
    expect(processVerifyRequest(get(`hub.mode=subscribe&hub.verify_token=${TOKEN}`), { verifyToken: TOKEN }).status).toBe(403);
    expect(processVerifyRequest(get(`hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1`), { verifyToken: undefined }).status).toBe(503);
  });
});

describe("webhook POST", () => {
  it("imzasız ve hatalı imzalı istek 401, hiçbir şey yazılmaz", async () => {
    const f = fake();
    const b = payload();
    expect((await processWebhookRequest(post(b), deps(f))).status).toBe(401);
    expect((await processWebhookRequest(post(b, sign(b + "x")), deps(f))).status).toBe(401);
    expect((await processWebhookRequest(post(b, "sha256=zz"), deps(f))).status).toBe(401);
    expect(f.calls).toEqual([]);
  });
  it("sır ya da erişim anahtarı tanımsızsa 503", async () => {
    const f = fake();
    const b = payload();
    expect((await processWebhookRequest(post(b, sign(b)), { ...deps(f), appSecret: undefined })).status).toBe(503);
    expect((await processWebhookRequest(post(b, sign(b)), deps(f, null))).status).toBe(503);
  });
  it("geçerli yük ingest_meta_lead çağırır ve durumu kaydeder", async () => {
    const f = fake();
    const b = payload();
    const res = await processWebhookRequest(post(b, sign(b)), deps(f));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, inserted: 1 });
    const ing = f.calls.find((c) => c.fn === "ingest_meta_lead");
    expect(ing?.args).toMatchObject({
      p_tenant: "t1",
      p_leadgen_id: "9001",
      p_form_id: "5005",
      p_full_name: "Deniz Örnek",
      p_phone: "+905550000000",
      p_created_time: "2026-10-07T10:00:00.000Z",
    });
    expect(f.calls.find((c) => c.fn === "meta_record_status")?.args).toMatchObject({ p_tenant: "t1", p_ok: true });
  });
  it("tekrar gelen başvuru seen döner ve 200", async () => {
    const f = fake({ ingest: { result: "seen" } });
    const b = payload();
    const res = await processWebhookRequest(post(b, sign(b)), deps(f));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, seen: 1 });
  });
  it("kiracısı olmayan sayfa atlanır; leadgen dışı alan ve geçersiz kimlik işlenmez", async () => {
    const f = fake({ tenant: null });
    const b = payload();
    expect(await (await processWebhookRequest(post(b, sign(b)), deps(f))).json()).toMatchObject({ ok: true, skipped: 1 });
    expect(f.calls.some((c) => c.fn === "ingest_meta_lead")).toBe(false);
    const g = fake();
    const bad = payload({ leadgen_id: "../x" });
    expect(await (await processWebhookRequest(post(bad, sign(bad)), deps(g))).json()).toMatchObject({ invalid: 1 });
    const other = JSON.stringify({ object: "page", entry: [{ id: "1", changes: [{ field: "feed", value: {} }] }] });
    expect((await processWebhookRequest(post(other, sign(other)), deps(g))).status).toBe(200);
    expect(g.calls).toEqual([]);
  });
  it("Graph hatasında 500; anahtarlar yanıta, loga ve durum kaydına sızmaz", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake();
    const graph = { lead: vi.fn().mockRejectedValue(new GraphError(400, 190)) } as unknown as Graph;
    const b = payload();
    const res = await processWebhookRequest(post(b, sign(b)), deps(f, graph));
    expect(res.status).toBe(500);
    const text = await res.text();
    const status = f.calls.find((c) => c.fn === "meta_record_status");
    expect(status?.args).toMatchObject({ p_ok: false });
    const all = JSON.stringify([text, status, spy.mock.calls]);
    for (const secret of [ACCESS, SECRET, TOKEN]) expect(all).not.toContain(secret);
    spy.mockRestore();
  });
  it("DB hatasında 500; ham hata ve kişisel veri loga ve duruma yazılmaz", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake({ ingestError: true });
    const b = payload();
    const res = await processWebhookRequest(post(b, sign(b)), deps(f));
    expect(res.status).toBe(500);
    const all = JSON.stringify([await res.text(), f.calls.find((c) => c.fn === "meta_record_status"), spy.mock.calls]);
    expect(all).not.toContain("905550000000");
    expect(all).not.toContain("Deniz");
    spy.mockRestore();
  });
  it("gövde 1 MB'ı aşarsa 413 (imzadan önce, hiçbir şey yazılmaz)", async () => {
    const f = fake();
    const big = "x".repeat(1_048_577);
    const withHeader = new Request("http://x/api/meta/webhook", { method: "POST", body: "{}", headers: { "content-length": "2000000" } });
    expect((await processWebhookRequest(withHeader, deps(f))).status).toBe(413);
    expect((await processWebhookRequest(post(big, sign(big)), deps(f))).status).toBe(413);
    expect((await processWebhookRequest(post(big), deps(f))).status).toBe(413);
    expect(f.calls).toEqual([]);
  });
  it("kalıcı Graph hatası (400, 404, kod 100) 200 döner, last_error yazar, diğer başvuruya devam eder", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const err of [new GraphError(400, null), new GraphError(404, null), new GraphError(400, 100)]) {
      const f = fake();
      const graph = { lead: vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(lead) } as unknown as Graph;
      const b = JSON.stringify({
        object: "page",
        entry: [
          {
            id: "111222333",
            changes: [
              { field: "leadgen", value: { leadgen_id: "9000", page_id: "111222333" } },
              { field: "leadgen", value: { leadgen_id: "9001", page_id: "111222333" } },
            ],
          },
        ],
      });
      const res = await processWebhookRequest(post(b, sign(b)), deps(f, graph));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, unreadable: 1, inserted: 1 });
      const st = f.calls.filter((c) => c.fn === "meta_record_status");
      expect(st[0]?.args).toMatchObject({ p_ok: false, p_error: PERMANENT_LEAD_TEXT });
    }
    spy.mockRestore();
  });
  it("geçici Graph hatası (500, 429, bağlantı, anahtar 190, sınır 17) 500 döner", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const err of [new GraphError(500, null), new GraphError(429, null), new GraphError(0, null), new GraphError(400, 190), new GraphError(400, 17)]) {
      const f = fake();
      const graph = { lead: vi.fn().mockRejectedValue(err) } as unknown as Graph;
      const b = payload();
      expect((await processWebhookRequest(post(b, sign(b)), deps(f, graph))).status).toBe(500);
    }
    spy.mockRestore();
  });
});
