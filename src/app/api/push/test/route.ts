import { toUserMessage } from "@/lib/errors";
import { testMessage } from "@/lib/push/messages";
import { sendToSubscriptions, vapidConfigured } from "@/lib/push/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
// Sunucu belleğinde en iyi gayret sınır (serverless'ta örnekler arası paylaşılmaz).
const lastRequest = new Map<string, number>();

/** Oturumlu üye kendi cihazlarına test bildirimi gönderir; dakikada en çok 1. */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ ok: false, error: "Oturum gerekli." }, { status: 401 });

  // Kilitli oturumda RPC 42501 döner: reddet.
  const status = await supabase.rpc("push_status");
  if (status.error) {
    const locked = status.error.code === "42501";
    return Response.json(
      { ok: false, error: locked ? "Panel kilitli. Önce PIN ile açın." : toUserMessage(status.error) },
      { status: locked ? 403 : 400 },
    );
  }

  if (!vapidConfigured()) {
    return Response.json({ ok: false, error: "Bildirim anahtarları sunucuya eklenmedi." }, { status: 503 });
  }

  const { data: me, error: meErr } = await supabase.rpc("current_member");
  if (meErr || !me) return Response.json({ ok: false, error: toUserMessage(meErr) }, { status: 400 });

  const nowMs = Date.now();
  const prev = lastRequest.get(me.id);
  if (prev !== undefined && nowMs - prev < WINDOW_MS) {
    return Response.json({ ok: false, error: "Test bildirimi dakikada bir gönderilebilir. Biraz bekleyip tekrar deneyin." }, { status: 429 });
  }

  // Abonelik anahtarları istemci rolüne kapalı; üye oturumla doğrulandıktan sonra sunucuda okunur.
  const admin = createAdminClient();
  const { data: subs, error: subErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("member_id", me.id);
  if (subErr) {
    console.error("[push] abonelikler okunamadı:", subErr.message);
    return Response.json({ ok: false, error: "Bildirim gönderilemedi. Biraz sonra tekrar deneyin." }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    return Response.json({ ok: false, error: "Bu hesapta bildirimi açık cihaz yok. Önce bu cihazda bildirimleri açın." }, { status: 409 });
  }

  lastRequest.set(me.id, nowMs);
  if (lastRequest.size > 500) {
    for (const [k, v] of lastRequest) if (nowMs - v >= WINDOW_MS) lastRequest.delete(k);
  }

  const res = await sendToSubscriptions(subs, testMessage());
  if (res.removed.length > 0) {
    const del = await admin.from("push_subscriptions").delete().in("endpoint", res.removed.map((r) => r.endpoint));
    if (del.error) console.error("[push] abonelik silinemedi:", del.error.message);
  }
  if (res.sent === 0) {
    return Response.json({ ok: false, error: "Bildirim gönderilemedi. Cihazda bildirimleri kapatıp yeniden açmayı deneyin." }, { status: 502 });
  }
  return Response.json({ ok: true, sent: res.sent });
}
