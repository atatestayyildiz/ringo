// Telegram Bot API istemcisi. `text` HTML-güvenli olmalı (messages.ts içindeki fonksiyonlar kaçışlı üretir).

export type SendOptions = {
  token?: string;
  fetchImpl?: typeof fetch;
  /** Test için bekleme davranışını değiştirir (ms). */
  sleep?: (ms: number) => Promise<void>;
};

export function botTokenConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type TgResponse = { ok: boolean; description?: string; error_code?: number; parameters?: { retry_after?: number } };

/** sendMessage (parse_mode HTML). 429'da retry_after kadar bir kez bekler. Hata fırlatır (token mesaja girmez). */
export async function sendMessage(chatId: number | string, text: string, opts: SendOptions = {}): Promise<void> {
  const token = opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Bot anahtarı tanımlı değil.");
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;

  const call = async (): Promise<{ status: number; body: TgResponse }> => {
    const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    let body: TgResponse = { ok: false };
    try {
      body = (await res.json()) as TgResponse;
    } catch {
      /* gövde JSON değil */
    }
    return { status: res.status, body };
  };

  let r = await call();
  if (r.status === 429) {
    const secs = Math.min(Math.max(r.body.parameters?.retry_after ?? 1, 1), 30);
    await sleep(secs * 1000);
    r = await call();
  }
  if (!r.body.ok) {
    throw new Error(`Telegram hatası ${r.body.error_code ?? r.status}: ${r.body.description ?? "bilinmeyen hata"}`);
  }
}
