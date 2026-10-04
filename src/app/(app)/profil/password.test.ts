import { describe, expect, it, vi } from "vitest";
import { changePassword, type PasswordDeps } from "./password";

const deps = (over: Partial<PasswordDeps> = {}): PasswordDeps => ({
  email: "elif@demo.test",
  verify: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn().mockResolvedValue({ error: null }),
  signOutOthers: vi.fn().mockResolvedValue({ error: null }),
  ...over,
});

describe("changePassword", () => {
  it("mevcut şifre boşsa hiçbir çağrı yapılmaz", async () => {
    const d = deps();
    expect(await changePassword("", "YeniSifre1", "YeniSifre1", d)).toEqual({ ok: false, error: "Mevcut şifreyi girin." });
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.update).not.toHaveBeenCalled();
  });
  it("kısa veya eşleşmeyen yeni şifre reddedilir", async () => {
    const d = deps();
    expect((await changePassword("Eski1234!", "kisa", "kisa", d)).ok).toBe(false);
    expect(await changePassword("Eski1234!", "YeniSifre1", "Baska1234", d)).toEqual({ ok: false, error: "Şifreler aynı değil." });
    expect(d.verify).not.toHaveBeenCalled();
  });
  it("mevcut şifre yanlışsa güncelleme yapılmaz", async () => {
    const d = deps({ verify: vi.fn().mockResolvedValue({ error: { code: "invalid_credentials", message: "x" } }) });
    expect(await changePassword("Yanlis123", "YeniSifre1", "YeniSifre1", d)).toEqual({ ok: false, error: "Mevcut şifre hatalı." });
    expect(d.verify).toHaveBeenCalledWith("elif@demo.test", "Yanlis123");
    expect(d.update).not.toHaveBeenCalled();
    expect(d.signOutOthers).not.toHaveBeenCalled();
  });
  it("başarıda şifre yazılır ve diğer oturumlar kapatılır", async () => {
    const d = deps();
    expect(await changePassword("Eski1234!", "YeniSifre1", "YeniSifre1", d)).toEqual({ ok: true });
    expect(d.update).toHaveBeenCalledWith("YeniSifre1");
    expect(d.signOutOthers).toHaveBeenCalledTimes(1);
  });
  it("güncelleme hatasında oturumlar kapatılmaz, Türkçe mesaj döner", async () => {
    const d = deps({ update: vi.fn().mockResolvedValue({ error: { code: "same_password", message: "x" } }) });
    expect(await changePassword("Eski1234!", "Eski1234!", "Eski1234!", d)).toEqual({
      ok: false,
      error: "Yeni şifre eskisiyle aynı olamaz.",
    });
    expect(d.signOutOthers).not.toHaveBeenCalled();
  });
  it("e-posta yoksa doğrulama yapılmaz", async () => {
    const d = deps({ email: null });
    expect((await changePassword("Eski1234!", "YeniSifre1", "YeniSifre1", d)).ok).toBe(false);
    expect(d.verify).not.toHaveBeenCalled();
  });
});
