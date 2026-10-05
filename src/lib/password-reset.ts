/** Şifre sıfırlama iş akışı (bağımlılıklar dışarıdan verilir, böylece birim testlenir). */

export const MIN_RESET_PASSWORD = 8;

/** Hesap var olsa da olmasa da, hata olsa da olmasa da aynı yanıt: hesap varlığı sızmaz. */
export const RESET_REQUEST_MESSAGE = "Bu e-posta kayıtlıysa bağlantı gönderdik. Gelen kutunu kontrol et.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

type AuthError = { code?: string; message?: string } | null;

export type RequestResult = { ok: true; message: string } | { ok: false; error: string };

/** Yanıt süresi tabanı: kayıtlı/kayıtsız hesap arasındaki gönderim süresi farkı yanıttan okunamasın. */
export const RESET_MIN_RESPONSE_MS = 400;

export type RequestOptions = {
  /** Gönderimi yanıttan ayırır (sunucuda Next `after`). Verilmezse arka planda başlatılır (fire-and-forget). */
  schedule?: (task: () => Promise<void>) => void;
  /** Toplam yanıt süresi tabanı (ms); test için ayarlanabilir. */
  minMs?: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function requestPasswordReset(
  email: unknown,
  send: (email: string) => Promise<{ error: AuthError }>,
  opts: RequestOptions = {},
): Promise<RequestResult> {
  const started = Date.now();
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  // Biçim denetimi hesap varlığıyla ilgisizdir; sızıntı değildir.
  if (value.length > 254 || !EMAIL_RE.test(value)) return { ok: false, error: "Geçerli bir e-posta adresi girin." };
  const task = async () => {
    try {
      const { error } = await send(value);
      // Hız sınırı, bilinmeyen hesap vb. dahil hiçbir hata kullanıcıya yansıtılmaz (yalnız kod günlüğe).
      if (error) console.error("[sifre-sifirla] gönderim:", error.code ?? "hata");
    } catch {
      console.error("[sifre-sifirla] gönderim: istisna");
    }
  };
  const schedule =
    opts.schedule ??
    ((t: () => Promise<void>) => {
      void t();
    });
  schedule(task);
  const wait = (opts.minMs ?? RESET_MIN_RESPONSE_MS) - (Date.now() - started);
  if (wait > 0) await sleep(wait);
  return { ok: true, message: RESET_REQUEST_MESSAGE };
}

export type CompleteDeps = {
  /** E-postadaki tek kullanımlık kodu doğrular; geçici oturum açar. */
  verify: (tokenHash: string) => Promise<{ error: AuthError }>;
  update: (password: string) => Promise<{ error: AuthError }>;
  /** Geçici oturum dahil kullanıcının tüm oturumlarını kapatır. */
  signOutAll: () => Promise<{ error: AuthError }>;
};

export type CompleteResult = { ok: true } | { ok: false; error: string; linkDead?: boolean };

const DEAD_LINK = "Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı isteyin.";

export async function completePasswordReset(
  tokenHash: unknown,
  type: unknown,
  password: unknown,
  repeat: unknown,
  deps: CompleteDeps,
): Promise<CompleteResult> {
  if (type !== "recovery" || typeof tokenHash !== "string" || !TOKEN_RE.test(tokenHash)) {
    return { ok: false, error: DEAD_LINK, linkDead: true };
  }
  if (typeof password !== "string" || password.length < MIN_RESET_PASSWORD) {
    return { ok: false, error: `Şifre en az ${MIN_RESET_PASSWORD} karakter olmalı.` };
  }
  if (password.length > 72) return { ok: false, error: "Şifre en fazla 72 karakter olabilir." };
  if (password !== repeat) return { ok: false, error: "Şifreler aynı değil." };

  const v = await deps.verify(tokenHash);
  if (v.error) return { ok: false, error: DEAD_LINK, linkDead: true };

  let failure: CompleteResult | null = null;
  try {
    const { error } = await deps.update(password);
    if (error) {
      if (error.code === "same_password") {
        failure = { ok: false, error: "Yeni şifre eskisiyle aynı olamaz. Yeni bir bağlantı isteyip farklı bir şifre seçin.", linkDead: true };
      } else if (error.code === "weak_password") {
        failure = { ok: false, error: "Şifre çok zayıf. Yeni bir bağlantı isteyip daha uzun veya karmaşık bir şifre seçin.", linkDead: true };
      } else {
        console.error("[sifre-sifirla] güncelleme:", error.code ?? "hata");
        failure = { ok: false, error: "Şifre değiştirilemedi. Yeni bir bağlantı isteyip tekrar deneyin.", linkDead: true };
      }
    }
  } finally {
    // Başarıda da başarısızlıkta da geçici oturum ve diğer tüm oturumlar kapanır.
    const out = await deps.signOutAll();
    if (out.error) console.error("[sifre-sifirla] oturum kapatma:", out.error.code ?? "hata");
  }
  return failure ?? { ok: true };
}
