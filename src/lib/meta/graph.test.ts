import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraph, describeError, graphVersion, GraphError } from "./graph";

const TOKEN = "SECRET-TOKEN-123";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("beklenmeyen çağrı");
    if (r instanceof Error) throw r;
    return r;
  });
  return { f: f as unknown as typeof fetch, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe("graph", () => {
  it("anahtar URL'de değil Authorization başlığında; sürüm varsayılanı v23.0, zaman aşımı sinyali var", async () => {
    vi.stubEnv("META_GRAPH_VERSION", "");
    const { f, calls } = fakeFetch(ok({ id: "123", field_data: [] }));
    await createGraph(TOKEN, f).lead("123");
    expect(graphVersion()).toBe("v23.0");
    expect(calls[0].url).toContain("/v23.0/123?");
    expect(calls[0].url).not.toContain(TOKEN);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.signal).toBeDefined();
  });
  it("META_GRAPH_VERSION kullanılır", async () => {
    vi.stubEnv("META_GRAPH_VERSION", "v99.0");
    const { f, calls } = fakeFetch(ok({ id: "1" }));
    await createGraph(TOKEN, f).lead("1");
    expect(calls[0].url).toContain("/v99.0/");
  });
  it("formlar imleçle sayfalanır; paging.next adresi kullanılmaz", async () => {
    const { f, calls } = fakeFetch(
      ok({ access_token: "PT" }),
      ok({ data: [{ id: "f1" }], paging: { cursors: { after: "C1" }, next: `https://graph.facebook.com/x?access_token=${TOKEN}` } }),
      ok({ data: [{ id: "f2" }], paging: { cursors: { after: "C2" } } }),
    );
    expect(await createGraph(TOKEN, f).forms("77")).toEqual(["f1", "f2"]);
    expect(calls[2].url).toContain("after=C1");
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer PT");
  });
  it("başvurular zaman filtresiyle istenir", async () => {
    const { f, calls } = fakeFetch(ok({ data: [{ id: "L1" }] }));
    expect(await createGraph(TOKEN, f).leads("f1", 1000.7)).toEqual([{ id: "L1" }]);
    const u = new URL(calls[0].url);
    expect(JSON.parse(u.searchParams.get("filtering") ?? "[]")).toEqual([{ field: "time_created", operator: "GREATER_THAN", value: 1000 }]);
  });
  it("sayfa token'ı alınır ve abonelik o token ile POST edilir", async () => {
    const { f, calls } = fakeFetch(ok({ access_token: "PAGE-TOKEN" }), ok({ success: true }));
    const g = createGraph(TOKEN, f);
    const pt = await g.pageToken("77");
    await g.subscribe("77", pt);
    expect(calls[1].url).toContain("/77/subscribed_apps");
    expect(calls[1].init.method).toBe("POST");
    expect(String(calls[1].init.body)).toContain("subscribed_fields=leadgen");
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer PAGE-TOKEN");
    expect(calls[1].url).not.toContain("PAGE-TOKEN");
  });
  it("hata mesajı anahtar içermez; ağ hatası da sızdırmaz", async () => {
    const { f } = fakeFetch(new Response(JSON.stringify({ error: { code: 190, message: `Invalid ${TOKEN}` } }), { status: 400 }), new Error(`boom ${TOKEN}`));
    const g = createGraph(TOKEN, f);
    const e1 = await g.lead("1").catch((e) => e);
    expect(e1).toBeInstanceOf(GraphError);
    expect(e1.code).toBe(190);
    expect(e1.message).not.toContain(TOKEN);
    const e2 = await g.lead("1").catch((e) => e);
    expect(e2.status).toBe(0);
    expect(e2.message).not.toContain(TOKEN);
    expect(describeError(e1)).toContain("erişim anahtarı");
  });
});

describe("formTypes", () => {
  it("soru anahtarını türe eşler, sayfa anahtarıyla ister ve önbelleğe alır", async () => {
    const { f, calls } = fakeFetch(
      ok({ access_token: "PT" }),
      ok({ questions: [{ key: "Adi_Soyadi", type: "FULL_NAME" }, { key: "telefon_numarasi", type: "PHONE" }, { type: "CUSTOM" }] }),
    );
    const g = createGraph(TOKEN, f);
    expect(await g.formTypes("F1", "77")).toEqual({ adi_soyadi: "FULL_NAME", telefon_numarasi: "PHONE" });
    expect(await g.formTypes("F1", "77")).toEqual({ adi_soyadi: "FULL_NAME", telefon_numarasi: "PHONE" });
    expect(calls).toHaveLength(2);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer PT");
  });
});
