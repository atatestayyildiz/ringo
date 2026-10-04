import { createAdminClient } from "@/lib/supabase/admin";
import { botTokenConfigured, sendMessage } from "@/lib/telegram/client";
import { processNotifyRequest } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";

function handle(req: Request) {
  return processNotifyRequest(req, {
    secret: process.env.CRON_SECRET,
    getAdmin: createAdminClient,
    send: botTokenConfigured() ? (chatId, text) => sendMessage(chatId, text) : null,
    appUrl: process.env.APP_URL,
  });
}

export const GET = handle;
export const POST = handle;
