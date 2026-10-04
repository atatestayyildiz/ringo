import { describe, expect, it, vi } from "vitest";
import { bearerToken, safeEqual } from "./auth";
import { sendMessage } from "./client";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("sendMessage", () => {
  it("HTML parse_mode ile gönderir", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: true }));
    await sendMessage(42, "merhaba", { token: "T0KEN", fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botT0KEN/sendMessage");
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: 42, text: "merhaba", parse_mode: "HTML" });
  });
  it("429'da retry_after kadar bekleyip bir kez yeniden dener", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(429, { ok: false, error_code: 429, parameters: { retry_after: 2 } }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await sendMessage(1, "x", { token: "t", fetchImpl: f as unknown as typeof fetch, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("ikinci 429'da fırlatır", async () => {
    const f = vi.fn().mockResolvedValue(res(429, { ok: false, error_code: 429, parameters: { retry_after: 1 } }));
    await expect(
      sendMessage(1, "x", { token: "t", fetchImpl: f as unknown as typeof fetch, sleep: async () => {} }),
    ).rejects.toThrow(/429/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("hata mesajı token içermez", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(res(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked" }));
    const err = await sendMessage(1, "x", { token: "SECRETTOKEN", fetchImpl: f as unknown as typeof fetch }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("SECRETTOKEN");
  });
  it("token yoksa fırlatır", async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(sendMessage(1, "x")).rejects.toThrow();
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});

describe("auth yardımcıları", () => {
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
  it("bearerToken", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
