import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { bearerToken, safeEqual } from "./auth";
import { notificationText, type TargetKind } from "./messages";
import type { Send } from "./webhook";

export type NotifyDeps = {
  getAdmin: () => SupabaseClient<Database>;
  /** null: bot anahtarı yok (gönderim ve kayıt yapılmaz). */
  send: Send | null;
  secret: string | undefined;
  appUrl?: string;
  now?: Date;
};

/** Europe/Istanbul takvim günü (YYYY-MM-DD). */
export function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const KINDS = new Set<string>(["morning", "reminder", "summary"]);

export async function processNotifyRequest(req: Request, deps: NotifyDeps): Promise<Response> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return Response.json({ ok: false }, { status: 401 });
  if (!deps.secret) return Response.json({ ok: false, error: "Zamanlayıcı sırrı yapılandırılmadı." }, { status: 503 });
  if (!safeEqual(token, deps.secret)) return Response.json({ ok: false }, { status: 401 });

  const admin = deps.getAdmin();
  const now = deps.now ?? new Date();
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const { data, error } = await admin.rpc("_notification_targets", { p_now: now.toISOString() });
  if (error) {
    console.error("[cron] hedefler okunamadı:", error.message);
    return Response.json({ ok: false, error: "Hedefler okunamadı." }, { status: 500 });
  }
  const targets = (data ?? []).filter((t) => KINDS.has(t.kind));

  if (dry) {
    return Response.json({
      ok: true,
      dry: true,
      botConfigured: deps.send !== null,
      count: targets.length,
      targets: targets.map((t) => ({
        member_id: t.member_id,
        kind: t.kind,
        text: notificationText(t.kind as TargetKind, t.payload, deps.appUrl),
      })),
    });
  }

  const day = istanbulDay(now);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of targets) {
    // Bot anahtarı yoksa kayıt yazma: anahtar gün içinde eklenirse o günün bildirimi kaybolmasın.
    if (!deps.send) {
      skipped++;
      continue;
    }
    let status: "sent" | "failed";
    let err: string | null = null;
    try {
      await deps.send(t.chat_id, notificationText(t.kind as TargetKind, t.payload, deps.appUrl));
      status = "sent";
    } catch (e) {
      status = "failed";
      err = e instanceof Error ? e.message : "bilinmeyen hata";
    }
    if (status === "sent") sent++;
    else failed++;
    const rec = await admin.rpc("_notification_record", {
      p_tenant: t.tenant_id,
      p_member: t.member_id,
      p_kind: t.kind,
      p_day: day,
      p_status: status,
      p_error: err as string,
    });
    if (rec.error) console.error("[cron] kayıt yazılamadı:", rec.error.message);
  }

  return Response.json({
    ok: true,
    sent,
    failed,
    skipped,
    ...(deps.send ? {} : { botConfigured: false, note: "Bot anahtarı tanımlı değil, gönderim yapılmadı ve kayıt tutulmadı." }),
  });
}
