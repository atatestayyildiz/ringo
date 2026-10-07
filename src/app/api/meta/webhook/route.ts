import { graphFromEnv } from "@/lib/meta/env";
import { processVerifyRequest, processWebhookRequest } from "@/lib/meta/process";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return processVerifyRequest(req, { verifyToken: process.env.META_VERIFY_TOKEN });
}

export function POST(req: Request) {
  return processWebhookRequest(req, {
    appSecret: process.env.META_APP_SECRET,
    verifyToken: process.env.META_VERIFY_TOKEN,
    graph: graphFromEnv(),
    getAdmin: createAdminClient,
  });
}
