import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { bearerToken, safeEqual } from "./auth";
import { messageFor } from "./messages";
import type { PushSub, SendFn } from "./send";

export type NotifyDeps = {
  getAdmin: () => SupabaseClient<Database>;
  /** null: VAPID anahtarları yok (gönderim ve kayıt yapılmaz). */
  send: SendFn | null;
  secret: string | undefined;
  now?: Date;
};

/** Europe/Istanbul takvim günü (YYYY-MM-DD). */
export function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function processNotifyRequest(req: Request, deps: NotifyDeps): Promise<Response> {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return Response.json({ ok: false }, { status: 401 });
  if (!deps.secret) return Response.json({ ok: false, error: "Zamanlayıcı sırrı yapılandırılmadı." }, { status: 503 });
  if (!safeEqual(token, deps.secret)) return Response.json({ ok: false }, { status: 401 });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  if (!dry && !deps.send) {
    return Response.json({ ok: false, error: "VAPID anahtarları yapılandırılmadı." }, { status: 503 });
  }

  const admin = deps.getAdmin();
  const now = deps.now ?? new Date();

  const { data, error } = await admin.rpc("_notification_targets", { p_now: now.toISOString() });
  if (error) {
    console.error("[cron] hedefler okunamadı:", error.message);
    return Response.json({ ok: false, error: "Hedefler okunamadı." }, { status: 500 });
  }
  const targets = (data ?? []).flatMap((t) => {
    const message = messageFor(t.kind, t.payload, t.ref_id);
    return message ? [{ ...t, message }] : [];
  });

  if (dry) {
    return Response.json({
      ok: true,
      dry: true,
      vapidConfigured: deps.send !== null,
      count: targets.length,
      targets: targets.map((t) => ({
        member_id: t.member_id,
        kind: t.kind,
        title: t.message.title,
        body: t.message.body,
      })),
    });
  }
  const send = deps.send as SendFn;

  // Hedef üyelerin abonelikleri tek sorguda okunur (service role; anahtarlar istemciye gitmez).
  const subsByMember = new Map<string, PushSub[]>();
  if (targets.length > 0) {
    const ids = [...new Set(targets.map((t) => t.member_id))];
    const subsRes = await admin.from("push_subscriptions").select("id, member_id, endpoint, p256dh, auth").in("member_id", ids);
    if (subsRes.error) {
      console.error("[cron] abonelikler okunamadı:", subsRes.error.message);
      return Response.json({ ok: false, error: "Abonelikler okunamadı." }, { status: 500 });
    }
    for (const row of subsRes.data ?? []) {
      const list = subsByMember.get(row.member_id) ?? [];
      list.push({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
      subsByMember.set(row.member_id, list);
    }
  }

  const day = istanbulDay(now);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let claimedElsewhere = 0;
  let removed = 0;
  for (const t of targets) {
    // Önce sahiplen: eşzamanlı çağrıda yalnız biri gönderir; başarısızlar sonraki çalışmada yeniden denenir.
    const claim = await admin.rpc("_notification_claim", {
      p_tenant: t.tenant_id,
      p_member: t.member_id,
      p_kind: t.kind,
      p_day: day,
      p_ref_id: t.ref_id,
    });
    if (claim.error) {
      console.error("[cron] sahiplenilemedi:", claim.error.message);
      failed++;
      continue;
    }
    if (claim.data === null || claim.data === undefined) {
      claimedElsewhere++;
      continue;
    }

    const subs = subsByMember.get(t.member_id) ?? [];
    let status: "sent" | "failed" | "skipped";
    let err: string | null = null;
    if (subs.length === 0) {
      status = "skipped";
      err = "abonelik yok";
      skipped++;
    } else {
      try {
        const res = await send(subs, t.message);
        if (res.removed.length > 0) {
          removed += res.removed.length;
          const del = await admin.from("push_subscriptions").delete().in("endpoint", res.removed.map((r) => r.endpoint));
          if (del.error) console.error("[cron] abonelik silinemedi:", del.error.message);
        }
        if (res.sent > 0) {
          status = "sent";
          sent++;
        } else {
          status = "failed";
          err = "hiçbir cihaza gönderilemedi";
          failed++;
        }
      } catch {
        status = "failed";
        err = "gönderim hatası";
        failed++;
      }
    }
    const fin = await admin.rpc("_notification_finish", { p_id: claim.data, p_status: status, p_error: err as string });
    if (fin.error) console.error("[cron] sonuç yazılamadı:", fin.error.message);
  }

  return Response.json({ ok: true, sent, failed, skipped, claimedElsewhere, removed });
}
