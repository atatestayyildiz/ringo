import webpush from "web-push";
import type { PushMessage } from "./messages";

export type PushSub = { id?: string; endpoint: string; p256dh: string; auth: string };

export type SendResult = {
  sent: number;
  failed: number;
  /** Tarayıcının artık geçersiz saydığı (404/410) abonelikler: silinmeli. */
  removed: PushSub[];
};

export type SendFn = (subs: PushSub[], message: PushMessage) => Promise<SendResult>;

export function vapidConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) throw new Error("VAPID anahtarları tanımlı değil.");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

/** Bildirimi tüm aboneliklere gönderir. Hata metni (anahtar içerebilir) dışarı verilmez; yalnız sayılar döner. */
export async function sendToSubscriptions(subs: PushSub[], message: PushMessage): Promise<SendResult> {
  configure();
  const body = JSON.stringify(message);
  const result: SendResult = { sent: 0, failed: 0, removed: [] };
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
          TTL: 3600,
          urgency: "high",
        });
        result.sent++;
      } catch (e) {
        const code = (e as { statusCode?: number } | null)?.statusCode;
        if (code === 404 || code === 410) result.removed.push(sub);
        else result.failed++;
      }
    }),
  );
  return result;
}
