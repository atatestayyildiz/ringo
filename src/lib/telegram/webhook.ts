import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { safeEqual } from "./auth";
import { helpText, linkedText, linkFailedText } from "./messages";

export type Send = (chatId: number, text: string) => Promise<void>;

export type WebhookDeps = {
  admin: SupabaseClient<Database>;
  send: Send;
  appUrl?: string;
};

export type UpdateResult = "linked" | "rejected" | "help" | "ignored" | "limited";

const START_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i;

/** Telegram update'ini işler. Yalnız özel sohbetlerdeki metin mesajları dikkate alınır. */
export async function handleTelegramUpdate(update: unknown, deps: WebhookDeps): Promise<UpdateResult> {
  const msg = (update as { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } } | null)?.message;
  const text = typeof msg?.text === "string" ? msg.text.trim() : null;
  const chatId = msg?.chat?.id;
  if (text === null || typeof chatId !== "number" || msg?.chat?.type !== "private") return "ignored";

  const reply = async (t: string) => {
    try {
      await deps.send(chatId, t);
    } catch (err) {
      console.error("[telegram] yanıt gönderilemedi:", err instanceof Error ? err.message : "bilinmeyen hata");
    }
  };

  const m = START_RE.exec(text);
  const code = m?.[1];
  if (!m || !code) {
    await reply(helpText(deps.appUrl));
    return "help";
  }

  const { data, error } = await deps.admin.rpc("_telegram_consume_link_code", { p_code: code, p_chat_id: chatId });
  if (error) {
    console.error("[telegram] kod tüketilemedi:", error.message);
    await reply(linkFailedText(undefined));
    return "rejected";
  }
  const res = (data ?? {}) as { ok?: boolean; full_name?: string; tenant_name?: string; reason?: string };
  // Sohbet başına deneme sınırı aşıldı: yanıt verme (botun gönderim kotası tüketilmesin)
  if (res.reason === "rate_limited") return "limited";
  if (res.ok) {
    await reply(linkedText(res.full_name ?? "", res.tenant_name ?? ""));
    return "linked";
  }
  await reply(linkFailedText(res.reason));
  return "rejected";
}

/** POST /api/telegram/webhook gövdesi: sır doğrulama + update işleme. Yetkili isteğe her zaman 200 döner. */
export async function processWebhookRequest(
  req: Request,
  deps: Omit<WebhookDeps, "admin"> & { secret: string | undefined; getAdmin: () => SupabaseClient<Database> },
): Promise<Response> {
  if (!deps.secret) return Response.json({ ok: false, error: "Webhook sırrı yapılandırılmadı." }, { status: 503 });
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(given, deps.secret)) return Response.json({ ok: false }, { status: 401 });

  try {
    const update = await req.json();
    await handleTelegramUpdate(update, { admin: deps.getAdmin(), send: deps.send, appUrl: deps.appUrl });
  } catch (err) {
    console.error("[telegram] webhook hatası:", err instanceof Error ? err.message : "bilinmeyen hata");
  }
  return Response.json({ ok: true });
}
