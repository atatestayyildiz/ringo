import { describe, expect, it, vi } from "vitest";
import { RESET_REQUEST_MESSAGE, completePasswordReset, requestPasswordReset } from "./password-reset";

describe("şifre sıfırlama isteği", () => {
  it("kayıtlı, kayıtsız, hız sınırlı ve hatalı gönderimde aynı yanıtı verir", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await requestPasswordReset("var@demo.test", async () => ({ error: null }));
    const unknown = await requestPasswordReset("yok@demo.test", async () => ({ error: { code: "user_not_found" } }));
    const limited = await requestPasswordReset("var@demo.test", async () => ({ error: { code: "over_email_send_rate_limit" } }));
    const thrown = await requestPasswordReset("var@demo.test", async () => {
      throw new Error("ağ");
    });
    for (const r of [ok, unknown, limited, thrown]) expect(r).toEqual({ ok: true, message: RESET_REQUEST_MESSAGE });
  });
  it("e-postayı küçük harfe çevirip kırpar", async () => {
    const send = vi.fn(async (email: string) => ({ error: null, email }));
    await requestPasswordReset("  Var@Demo.Test ", send);
    expect(send).toHaveBeenCalledWith("var@demo.test");
  });
  it("geçersiz biçimde göndermez", async () => {
    const send = vi.fn(async (email: string) => ({ error: null, email }));
    expect((await requestPasswordReset("abc", send)).ok).toBe(false);
    expect((await requestPasswordReset(undefined, send)).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

const TOKEN = "a".repeat(40);
type Err = { code?: string; message?: string } | null;
const mk = (over: { verify?: () => Promise<{ error: Err }>; update?: () => Promise<{ error: Err }> } = {}) => ({
  verify: vi.fn(over.verify ?? (async () => ({ error: null as Err }))),
  update: vi.fn(over.update ?? (async () => ({ error: null as Err }))),
  signOutAll: vi.fn(async () => ({ error: null as Err })),
});

describe("şifre sıfırlamayı tamamlama", () => {
  it("başarıda doğrular, günceller ve oturumları kapatır", async () => {
    const d = mk();
    expect(await completePasswordReset(TOKEN, "recovery", "YeniSifre1", "YeniSifre1", d)).toEqual({ ok: true });
    expect(d.verify).toHaveBeenCalledWith(TOKEN);
    expect(d.update).toHaveBeenCalledWith("YeniSifre1");
    expect(d.signOutAll).toHaveBeenCalled();
  });
  it("kısa şifre, uyuşmayan tekrar, yanlış tür ve bozuk kodda hiçbir çağrı yapmaz", async () => {
    const d = mk();
    expect((await completePasswordReset(TOKEN, "recovery", "kisa", "kisa", d)).ok).toBe(false);
    expect((await completePasswordReset(TOKEN, "recovery", "YeniSifre1", "Baska1234", d)).ok).toBe(false);
    expect((await completePasswordReset(TOKEN, "signup", "YeniSifre1", "YeniSifre1", d)).ok).toBe(false);
    expect((await completePasswordReset("../x", "recovery", "YeniSifre1", "YeniSifre1", d)).ok).toBe(false);
    expect((await completePasswordReset(undefined, "recovery", "YeniSifre1", "YeniSifre1", d)).ok).toBe(false);
    expect(d.verify).not.toHaveBeenCalled();
  });
  it("geçersiz kodda şifre güncellenmez, ham hata sızmaz", async () => {
    const d = mk({ verify: async () => ({ error: { code: "otp_expired", message: "Token has expired" } }) });
    const r = await completePasswordReset(TOKEN, "recovery", "YeniSifre1", "YeniSifre1", d);
    expect(r).toMatchObject({ ok: false, linkDead: true });
    expect(JSON.stringify(r)).not.toContain("Token has expired");
    expect(d.update).not.toHaveBeenCalled();
  });
  it("güncelleme hatasında da oturum kapanır, ham hata sızmaz", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = mk({ update: async () => ({ error: { code: "unexpected_failure", message: "pg: boom" } }) });
    const r = await completePasswordReset(TOKEN, "recovery", "YeniSifre1", "YeniSifre1", d);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("boom");
    expect(d.signOutAll).toHaveBeenCalled();
  });
});
