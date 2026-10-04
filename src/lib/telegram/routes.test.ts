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
});

describe("cron notify", () => {
  const targets = [
    { tenant_id: "t1", member_id: "m1", kind: "reminder", chat_id: 11, payload: { first_name: "Elif", retry_count: 4 } },
    { tenant_id: "t1", member_id: "m2", kind: "reminder", chat_id: 12, payload: { first_name: "Can", retry_count: 1 } },
  ];
  const mk = () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      return { data: fn === "_notification_targets" ? targets : null, error: null };
    };
    return { calls, getAdmin: () => fakeAdmin(rpc) };
  };
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
    const res = await processNotifyRequest(r("Bearer s", "?dry=1"), { getAdmin, send, secret: "s", appUrl: "https://a.b" });
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(body.count).toBe(2);
    expect(body.targets[0].text).toBe("Elif, 4 tekrar araman bekliyor. https://a.b/bugun");
    expect(body.targets[0].chat_id).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["_notification_targets"]);
  });
  it("token yokken hedefler 'skipped' kaydedilir ve yanıt söyler", async () => {
    const { getAdmin, calls } = mk();
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send: null, secret: "s" })).json();
    expect(body).toMatchObject({ sent: 0, failed: 0, skipped: 2, botConfigured: false });
    expect(calls.filter((c) => c.fn === "_notification_record").every((c) => c.args.p_status === "skipped")).toBe(true);
  });
  it("gönderim: başarı ve hata sayılır, her biri kaydedilir", async () => {
    const { getAdmin, calls } = mk();
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Telegram hatası 403"));
    const body = await (await processNotifyRequest(r("Bearer s"), { getAdmin, send, secret: "s" })).json();
    expect(body).toMatchObject({ sent: 1, failed: 1, skipped: 0 });
    const rec = calls.filter((c) => c.fn === "_notification_record");
    expect(rec.map((c) => c.args.p_status)).toEqual(["sent", "failed"]);
  });
});
