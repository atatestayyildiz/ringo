import { describe, expect, it, vi } from "vitest";
import { processNotifyRequest } from "./notify";
import { handleTelegramUpdate, processWebhookRequest } from "./webhook";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const fakeAdmin = (rpc: Rpc) => ({ rpc }) as never;

const update = (text: string, type = "private") => ({ message: { text, chat: { id: 555, type } } });

describe("webhook yetkilendirme", () => {
  const base = {
    getAdmin: () => fakeAdmin(async () => ({ data: { ok: false, reason: "invalid" }, error: null })),
    send: vi.fn(),
  };
  const req = (secret?: string) =>
    new Request("http://x/api/telegram/webhook", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: JSON.stringify(update("/start")),
    });

  it("sır yapılandırılmamışsa 503", async () => {
    expect((await processWebhookRequest(req("a"), { ...base, secret: undefined })).status).toBe(503);
  });
  it("yanlış veya eksik sırda 401", async () => {
    expect((await processWebhookRequest(req("yanlis"), { ...base, secret: "dogru" })).status).toBe(401);
    expect((await processWebhookRequest(req(), { ...base, secret: "dogru" })).status).toBe(401);
  });
  it("doğru sırda 200, bozuk gövdede de 200", async () => {
    expect((await processWebhookRequest(req("dogru"), { ...base, secret: "dogru" })).status).toBe(200);
    const bad = new Request("http://x", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "dogru" },
      body: "{",
    });
    expect((await processWebhookRequest(bad, { ...base, secret: "dogru" })).status).toBe(200);
  });
});

describe("handleTelegramUpdate", () => {
  it("kodsuz /start yardım döner, rpc çağrılmaz", async () => {
    const rpc = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await handleTelegramUpdate(update("/start"), { admin: fakeAdmin(rpc), send })).toBe("help");
    expect(rpc).not.toHaveBeenCalled();
    expect(send.mock.calls[0][1]).toContain("/start KOD");
  });
  it("grup sohbetini ve metinsiz update'i yok sayar", async () => {
    const send = vi.fn();
    expect(await handleTelegramUpdate(update("/start ABCDEFGH", "group"), { admin: fakeAdmin(vi.fn()), send })).toBe(
      "ignored",
    );
    expect(await handleTelegramUpdate({ edited: 1 }, { admin: fakeAdmin(vi.fn()), send })).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });
  it("geçerli kod: rpc doğru argümanlarla, bağlandı mesajı", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, full_name: "Elif Demir", tenant_name: "Demo" }, error: null });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await handleTelegramUpdate(update("/start@demo_bot ABCD2345"), { admin: fakeAdmin(rpc), send })).toBe("linked");
    expect(rpc).toHaveBeenCalledWith("_telegram_consume_link_code", { p_code: "ABCD2345", p_chat_id: 555 });
    expect(send.mock.calls[0][1]).toContain("Bağlantı kuruldu");
  });
  it("geçersiz kod reddedilir", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, reason: "expired" }, error: null });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await handleTelegramUpdate(update("/start ABCD2345"), { admin: fakeAdmin(rpc), send })).toBe("rejected");
    expect(send.mock.calls[0][1]).toContain("süresi dolmuş");
  });
  it("deneme sınırı aşıldıysa (rate_limited) yanıt verilmez", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, reason: "rate_limited" }, error: null });
    const send = vi.fn();
    expect(await handleTelegramUpdate(update("/start ABCD2345"), { admin: fakeAdmin(rpc), send })).toBe("limited");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("cron notify", () => {
  const targets = [
    { tenant_id: "t1", member_id: "m1", kind: "reminder", chat_id: 11, payload: { first_name: "Elif", retry_count: 4 } },
    { tenant_id: "t1", member_id: "m2", kind: "reminder", chat_id: 12, payload: { first_name: "Can", retry_count: 1 } },
  ];

  /** notification_log taklidi: claim/finish ve hedef dışlama kuralları migration 0900 ile aynı. */
  const mk = () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const log = new Map<number, { slot: string; status: string; attempts: number }>();
    let seq = 0;
    const find = (slot: string) => [...log.entries()].find(([, row]) => row.slot === slot);
    const slotOf = (a: Record<string, unknown>) => `${a.p_member}|${a.p_kind}|${a.p_day}`;
    const done = (slot: string) => {
      const row = find(slot)?.[1];
      return Boolean(row && (row.status === "sent" || row.status === "sending" || row.attempts >= 3));
    };
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "_notification_targets") {
        return { data: targets.filter((t) => !done(`${t.member_id}|${t.kind}|2026-10-04`)), error: null };
      }
      if (fn === "_notification_claim") {
        const slot = slotOf(args);
        const hit = find(slot);
        if (!hit) {
          log.set(++seq, { slot, status: "sending", attempts: 1 });
          return { data: seq, error: null };
        }
        const [id, row] = hit;
        if (row.status === "failed" && row.attempts < 3) {
          row.status = "sending";
          row.attempts++;
          return { data: id, error: null };
        }
        return { data: null, error: null };
      }
      if (fn === "_notification_finish") {
        const row = log.get(args.p_id as number);
        if (row && row.status === "sending") row.status = args.p_status as string;
      }
      return { data: null, error: null };
    };
    return { calls, log, getAdmin: () => fakeAdmin(rpc) };
  };
  const now = new Date("2026-10-04T12:05:00Z");
  const r = (auth?: string, qs = "") =>
    new Request(`http://x/api/cron/notify${qs}`, { headers: auth ? { authorization: auth } : {} });

  it("Bearer yoksa 401, yanlışsa 401, sır yoksa 503", async () => {
    const { getAdmin } = mk();
    expect((await processNotifyRequest(r(), { getAdmin, send: null, secret: "s" })).status).toBe(401);
    expect((await processNotifyRequest(r("Bearer x"), { getAdmin, send: null, secret: "s" })).status).toBe(401);
    expect((await processNotifyRequest(r("Bearer s"), { getAdmin, send: null, secret: undefined })).status).toBe(503);
  });
  it("?dry=1 gönderim ve kayıt yapmadan metinleri döner", async () => {
    const { getAdmin, calls } = mk();
    const send = vi.fn();
    const res = await processNotifyRequest(r("Bearer s", "?dry=1"), { getAdmin, send, secret: "s", appUrl: "https://a.b", now });
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(body.count).toBe(2);
    expect(body.targets[0].text).toBe("Elif, 4 tekrar araman bekliyor. https://a.b/bugun");
    expect(body.targets[0].chat_id).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["_notification_targets"]);
  });
  it("token yokken sahiplenme ve kayıt yapılmaz, yanıt söyler", async () => {
    const { getAdmin, calls } = mk();
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send: null, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 0, failed: 0, skipped: 2, botConfigured: false });
    expect(calls.map((c) => c.fn)).toEqual(["_notification_targets"]);
  });
  it("gönderim: önce sahiplen, sonra gönder, sonra sonucu yaz", async () => {
    const { getAdmin, calls } = mk();
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Telegram hatası 403"));
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 1, failed: 1, skipped: 0 });
    expect(calls.map((c) => c.fn)).toEqual([
      "_notification_targets",
      "_notification_claim",
      "_notification_finish",
      "_notification_claim",
      "_notification_finish",
    ]);
    expect(calls[1].args).toEqual({ p_tenant: "t1", p_member: "m1", p_kind: "reminder", p_day: "2026-10-04" });
    const fin = calls.filter((c) => c.fn === "_notification_finish");
    expect(fin.map((c) => c.args.p_status)).toEqual(["sent", "failed"]);
    expect(fin[1].args.p_error).toBe("Telegram hatası 403");
  });
  it("eşzamanlı iki çağrı: her hedefe tek gönderim", async () => {
    const { getAdmin } = mk();
    const send = vi.fn().mockResolvedValue(undefined);
    const deps = { getAdmin, send, secret: "s", now };
    const [a, b] = await Promise.all([processNotifyRequest(r("Bearer s"), deps), processNotifyRequest(r("Bearer s"), deps)]);
    const bodies = [await a.json(), await b.json()];
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual([11, 12]);
    expect(bodies[0].sent + bodies[1].sent).toBe(2);
    expect(bodies[0].claimedElsewhere + bodies[1].claimedElsewhere).toBe(2);
  });
  it("başarısız gönderim sonraki çalışmada yeniden denenir, 3 denemeden sonra durur", async () => {
    const a = mk();
    const failing = vi.fn().mockRejectedValue(new Error("Telegram hatası 502"));
    for (let i = 0; i < 4; i++) await processNotifyRequest(r("Bearer s"), { getAdmin: a.getAdmin, send: failing, secret: "s", now });
    expect(failing).toHaveBeenCalledTimes(6); // 2 hedef x 3 deneme
    expect([...a.log.values()].map((x) => `${x.status}/${x.attempts}`)).toEqual(["failed/3", "failed/3"]);

    const b = mk();
    const flaky = vi.fn().mockRejectedValueOnce(new Error("ağ")).mockResolvedValue(undefined);
    await processNotifyRequest(r("Bearer s"), { getAdmin: b.getAdmin, send: flaky, secret: "s", now });
    const second = await (await processNotifyRequest(r("Bearer s"), { getAdmin: b.getAdmin, send: flaky, secret: "s", now })).json();
    expect(second).toMatchObject({ sent: 1, failed: 0 });
    expect([...b.log.values()].map((x) => `${x.status}/${x.attempts}`)).toEqual(["sent/2", "sent/1"]);
  });
  it("sahiplenme hatası gönderimi engeller", async () => {
    const send = vi.fn();
    const rpc: Rpc = async (fn) =>
      fn === "_notification_targets" ? { data: targets.slice(0, 1), error: null } : { data: null, error: { message: "db" } };
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin: () => fakeAdmin(rpc), send, secret: "s", now })).json();
    expect(body).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
  });
});
