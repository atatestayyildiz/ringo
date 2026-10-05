import { createAdminClient } from "@/lib/supabase/admin";
import { processNotifyRequest } from "@/lib/push/notify";
import { sendToSubscriptions, vapidConfigured } from "@/lib/push/send";

export const dynamic = "force-dynamic";

function handle(req: Request) {
  return processNotifyRequest(req, {
    secret: process.env.CRON_SECRET,
    getAdmin: createAdminClient,
    send: vapidConfigured() ? sendToSubscriptions : null,
  });
}

export const GET = handle;
export const POST = handle;
