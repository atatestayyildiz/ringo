import { describe, expect, it, vi } from "vitest";
import { GraphError, type Graph } from "./graph";
import { parseHours, processSyncRequest, sinceFor, syncConnections } from "./sync";

const now = new Date("2026-10-07T12:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);

function fake(conns = [{ tenant_id: "t1", page_id: "111", last_sync_at: null as string | null }]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "meta_connections_list") return { data: conns, error: null };
      if (fn === "ingest_meta_lead") return { data: { result: args.p_leadgen_id === "L2" ? "seen" : "inserted" }, error: null };
      return { data: null, error: null };
    },
  };
  return { calls, getAdmin: () => admin as never, admin: admin as never };
}
const mkGraph = (over: Partial<Graph> = {}) =>
  ({
    forms: vi.fn().mockResolvedValue(["F1", "F2"]),
    leads: vi.fn(async (form: string) =>
      form === "F1" ? [{ id: "L1", field_data: [{ name: "phone", values: ["p:+905551112233"] }] }, { id: "L2" }] : [{ id: "L3", form_id: "F2" }],
    ),
    ...over,
  }) as unknown as Graph;

describe("parseHours / sinceFor", () => {
  it("hours 1-168 aralığına sıkıştırılır, sayı değilse yok sayılır", () => {
    expect(parseHours("24")).toBe(24);
    expect(parseHours("0")).toBe(1);
    expect(parseHours("9999")).toBe(168);
    expect(parseHours("abc")).toBeUndefined();
    expect(parseHours("-5")).toBeUndefined();
    expect(parseHours("1.5")).toBeUndefined();
    expect(parseHours(null)).toBeUndefined();
  });
  it("ilk seferde 24 saat, sonra son tarama eksi 30 dk, hours verilirse o kadar geri", () => {
    expect(sinceFor({ tenant_id: "t", page_id: "p", last_sync_at: null }, now)).toBe(nowSec - 24 * 3600);
    expect(sinceFor({ tenant_id: "t", page_id: "p", last_sync_at: "2026-10-07T11:00:00Z" }, now)).toBe(nowSec - 3600 - 1800);
    expect(sinceFor({ tenant_id: "t", page_id: "p", last_sync_at: "2026-10-07T11:00:00Z" }, now, 168)).toBe(nowSec - 168 * 3600);
  });
});

describe("syncConnections", () => {
  it("formları gezer, her başvuruyu ekler, seen sayılır, durumu synced ile yazar", async () => {
    const f = fake();
    const g = mkGraph();
    const sum = await syncConnections(f.admin, g, [{ tenant_id: "t1", page_id: "111", last_sync_at: null }], { now });
    expect(sum).toMatchObject({ connections: 1, failed: 0, leads: 3, inserted: 2, seen: 1 });
    expect(g.leads).toHaveBeenCalledWith("F1", nowSec - 24 * 3600);
    const ing = f.calls.filter((c) => c.fn === "ingest_meta_lead");
    expect(ing.map((c) => c.args.p_leadgen_id)).toEqual(["L1", "L2", "L3"]);
    expect(ing[0].args).toMatchObject({ p_phone: "+905551112233", p_form_id: "F1" });
    expect(f.calls.at(-1)).toEqual({ fn: "meta_record_status", args: { p_tenant: "t1", p_ok: true, p_error: null, p_synced: true } });
  });
  it("bir bağlantı hata verirse durumuna yazılır, diğerleri sürer", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake();
    const g = mkGraph({ forms: vi.fn().mockRejectedValueOnce(new GraphError(400, 190)).mockResolvedValue([]) });
    const sum = await syncConnections(
      f.admin,
      g,
      [
        { tenant_id: "t1", page_id: "1", last_sync_at: null },
        { tenant_id: "t2", page_id: "2", last_sync_at: null },
      ],
      { now },
    );
    expect(sum).toMatchObject({ connections: 2, failed: 1 });
    const st = f.calls.filter((c) => c.fn === "meta_record_status");
    expect(st[0].args).toMatchObject({ p_tenant: "t1", p_ok: false });
    expect(st[1].args).toMatchObject({ p_tenant: "t2", p_ok: true, p_synced: true });
    spy.mockRestore();
  });
});

describe("processSyncRequest", () => {
  const r = (auth?: string, qs = "") => new Request(`http://x/api/cron/meta-sync${qs}`, { headers: auth ? { authorization: auth } : {} });
  it("Bearer yoksa 401, yanlışsa 401, sır yoksa 503, Graph yoksa 503", async () => {
    const f = fake();
    expect((await processSyncRequest(r(), { secret: "s", graph: mkGraph(), getAdmin: f.getAdmin })).status).toBe(401);
    expect((await processSyncRequest(r("Bearer x"), { secret: "s", graph: mkGraph(), getAdmin: f.getAdmin })).status).toBe(401);
    expect((await processSyncRequest(r("Bearer s"), { secret: undefined, graph: mkGraph(), getAdmin: f.getAdmin })).status).toBe(503);
    expect((await processSyncRequest(r("Bearer s"), { secret: "s", graph: null, getAdmin: f.getAdmin })).status).toBe(503);
    expect(f.calls).toEqual([]);
  });
  it("hours sınırı uygulanır ve sonuç özeti döner", async () => {
    const f = fake();
    const g = mkGraph();
    const res = await processSyncRequest(r("Bearer s", "?hours=9999"), { secret: "s", graph: g, getAdmin: f.getAdmin, now });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, leads: 3 });
    expect(g.leads).toHaveBeenCalledWith("F1", nowSec - 168 * 3600);
  });
});
