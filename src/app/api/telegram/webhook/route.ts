import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram/client";
import { processWebhookRequest } from "@/lib/telegram/webhook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return processWebhookRequest(req, {
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    getAdmin: createAdminClient,
    send: (chatId, text) => sendMessage(chatId, text),
    appUrl: process.env.APP_URL,
  });
}
