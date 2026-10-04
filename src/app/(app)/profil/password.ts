import { toUserMessage } from "@/lib/errors";

export const MIN_PASSWORD = 8;

type AuthError = { code?: string; message: string } | null;

export type PasswordDeps = {
  email: string | null | undefined;
  /** Mevcut şifreyi oturumdan bağımsız, geçici bir istemciyle doğrular. */
  verify: (email: string, password: string) => Promise<{ error: AuthError }>;
  update: (password: string) => Promise<{ error: AuthError }>;
  /** Bu oturum dışındaki tüm oturumları kapatır. */
  signOutOthers: () => Promise<{ error: AuthError }>;
};

export type PasswordResult = { ok: true } | { ok: false; error: string };

/** Şifre değiştirme: mevcut şifre doğrulanır, yeni şifre yazılır, diğer oturumlar kapatılır. */
export async function changePassword(
  current: unknown,
  password: unknown,
  repeat: unknown,
  deps: PasswordDeps,
): Promise<PasswordResult> {
  if (typeof current !== "string" || current.length === 0) return { ok: false, error: "Mevcut şifreyi girin." };
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return { ok: false, error: `Şifre en az ${MIN_PASSWORD} karakter olmalı.` };
  }
  if (password !== repeat) return { ok: false, error: "Şifreler aynı değil." };
  if (!deps.email) return { ok: false, error: "Oturum bilgisi okunamadı. Çıkış yapıp tekrar girin." };

  const v = await deps.verify(deps.email, current);
  if (v.error) {
    if (v.error.code === "invalid_credentials") return { ok: false, error: "Mevcut şifre hatalı." };
    if (v.error.code === "over_request_rate_limit" || v.error.code === "over_email_send_rate_limit") {
      return { ok: false, error: "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin." };
    }
    return { ok: false, error: "Mevcut şifre doğrulanamadı." };
  }

  const { error } = await deps.update(password);
  if (error) {
    if (error.code === "same_password") return { ok: false, error: "Yeni şifre eskisiyle aynı olamaz." };
    if (error.code === "weak_password") return { ok: false, error: "Şifre çok zayıf. Daha uzun veya karmaşık bir şifre seçin." };
    return { ok: false, error: toUserMessage({ code: error.code, message: error.message }) };
  }

  const out = await deps.signOutOthers();
  if (out.error) console.error("[profil] diğer oturumlar kapatılamadı:", out.error.code ?? out.error.message);
  return { ok: true };
}
