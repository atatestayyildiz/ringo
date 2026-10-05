import { describe, expect, it, vi } from "vitest";
import { processNotifyRequest } from "./notify";
import type { SendFn } from "./send";

type Res = { data: unknown; error: { message: string } | null };

const targets = [
  { tenant_id: "t1", member_id: "m1", kind: "callback", ref_id: "c1", payload: { first_name: "Esra", last_initial: "U", at: "14:30" } },
  { tenant_id: "t1", member_id: "m2", kind: "appointment", ref_id: "c2", payload: { first_name: "Can", last_initial: "Y", time: "16:00" } },
];
const subRows = [
  { id: "s1", member_id: "m1", endpoint: "https://p/1", p256dh: "k", auth: "a" },
  { id: "s2", member_id: "m2", endpoint: "https://p/2", p256dh: "k", auth: "a" },
];

function fake(opts: { claim?: (args: Record<string, unknown>) => Res; subs?: typeof subRows } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const deleted: string[][] = [];
  let seq = 0;
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>): Promise<Res> => {
      calls.push({ fn, args });
      if (fn === "_notification_targets") return { data: targets, error: null };
      if (fn === "_notification_claim") return opts.claim ? opts.claim(args) : { data: ++seq, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      expect(table).toBe("push_subscriptions");
      return {
        select: () => ({ in: async () => ({ data: opts.subs ?? subRows, error: null }) }),
        delete: () => ({
          in: async (_col: string, vals: string[]) => {
            deleted.push(vals);
            return { error: null };
          },
        }),
      };
    },
  };
  return { calls, deleted, getAdmin: () => admin as never };
}

const now = new Date("2026-10-04T12:05:00Z");
const r = (auth?: string, qs = "") => new Request(`http://x/api/cron/notify${qs}`, { headers: auth ? { authorization: auth } : {} });
const ok = (): SendFn => vi.fn().mockResolvedValue({ sent: 1, failed: 0, removed: [] });

describe("processNotifyRequest", () => {
  it("Bearer yoksa 401, yanlışsa 401, sır yoksa 503", async () => {
    const { getAdmin } = fake();
    expect((await processNotifyRequest(r(), { getAdmin, send: ok(), secret: "s" })).status).toBe(401);
    expect((await processNotifyRequest(r("Bearer x"), { getAdmin, send: ok(), secret: "s" })).status).toBe(401);
    expect((await processNotifyRequest(r("Bearer s"), { getAdmin, send: ok(), secret: undefined })).status).toBe(503);
  });
  it("VAPID yoksa 503 ve hiçbir şey yazılmaz", async () => {
    const { getAdmin, calls } = fake();
    expect((await processNotifyRequest(r("Bearer s"), { getAdmin, send: null, secret: "s", now })).status).toBe(503);
    expect(calls).toEqual([]);
  });
  it("?dry=1 gönderim ve sahiplenme yapmadan hedefleri döner", async () => {
    const { getAdmin, calls } = fake();
    const send = ok();
    const body = await (await processNotifyRequest(r("Bearer s", "?dry=1"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ dry: true, count: 2 });
    expect(body.targets[0]).toMatchObject({ member_id: "m1", kind: "callback", title: "Geri arama vakti" });
    expect(body.targets[0].body).toContain("Esra U.");
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["_notification_targets"]);
  });
  it("claim null ise atlanır, gönderilmez", async () => {
    const { getAdmin, calls } = fake({ claim: () => ({ data: null, error: null }) });
    const send = ok();
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 0, claimedElsewhere: 2 });
    expect(send).not.toHaveBeenCalled();
    expect(calls.some((c) => c.fn === "_notification_finish")).toBe(false);
  });
  it("sahiplen, gönder, sonucu yaz; claim argümanları doğru", async () => {
    const { getAdmin, calls } = fake();
    const send = ok();
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 2, failed: 0, skipped: 0 });
    expect(calls[1]).toEqual({
      fn: "_notification_claim",
      args: { p_tenant: "t1", p_member: "m1", p_kind: "callback", p_day: "2026-10-04", p_ref_id: "c1" },
    });
    const fin = calls.filter((c) => c.fn === "_notification_finish");
    expect(fin.map((c) => c.args.p_status)).toEqual(["sent", "sent"]);
    expect((send as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toContain("14:30");
  });
  it("hepsi başarısızsa failed", async () => {
    const { getAdmin, calls } = fake();
    const send: SendFn = vi.fn().mockResolvedValue({ sent: 0, failed: 1, removed: [] });
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 0, failed: 2 });
    expect(calls.filter((c) => c.fn === "_notification_finish").map((c) => c.args.p_status)).toEqual(["failed", "failed"]);
  });
  it("gönderici fırlatırsa failed, hata metni sızmaz", async () => {
    const { getAdmin, calls } = fake();
    const send: SendFn = vi.fn().mockRejectedValue(new Error("gizli-anahtar-xyz"));
    await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now });
    const fin = calls.filter((c) => c.fn === "_notification_finish");
    expect(fin.map((c) => c.args.p_status)).toEqual(["failed", "failed"]);
    expect(JSON.stringify(fin)).not.toContain("gizli-anahtar-xyz");
  });
  it("aboneliği olmayan hedef skipped", async () => {
    const { getAdmin, calls } = fake({ subs: subRows.slice(0, 1) });
    const send = ok();
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 1, skipped: 1 });
    expect(calls.filter((c) => c.fn === "_notification_finish").map((c) => c.args.p_status)).toEqual(["sent", "skipped"]);
  });
  it("404/410 gelen abonelik silinir", async () => {
    const { getAdmin, deleted } = fake();
    const send: SendFn = vi
      .fn()
      .mockResolvedValueOnce({ sent: 0, failed: 0, removed: [{ endpoint: "https://p/1", p256dh: "k", auth: "a" }] })
      .mockResolvedValueOnce({ sent: 1, failed: 0, removed: [] });
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(deleted).toEqual([["https://p/1"]]);
    expect(body).toMatchObject({ sent: 1, failed: 1, removed: 1 });
  });
});
