import { feedbackFromEnv } from "@/lib/meta/feedback";
import { graphFromEnv } from "@/lib/meta/env";
import { processSyncRequest } from "@/lib/meta/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function handle(req: Request) {
  return processSyncRequest(req, { secret: process.env.CRON_SECRET, graph: graphFromEnv(), getAdmin: createAdminClient, feedback: feedbackFromEnv() });
}

export const GET = handle;
export const POST = handle;
