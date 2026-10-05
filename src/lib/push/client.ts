// Tarayıcı tarafı push yardımcıları (yalnız istemci bileşenlerinden çağrılır).
import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { parsePushStatus, type PushStatus } from "./status";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

export class PushClientError extends Error {}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS masaüstü kimliğiyle gelir.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => undefined);
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** Bu cihazın durumu. iPhone'da ana ekrana eklenmemişse tarayıcı push'u hiç sunmaz; önce o kontrol edilir. */
export async function detectPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new PushClientError("Bu cihaz bildirim anahtarı vermedi. Başka bir tarayıcıyı deneyin.");
  const supabase = createClient();
  const { error } = await supabase.rpc("push_subscribe", {
    p_endpoint: json.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new PushClientError(toUserMessage(error));
}

/** Kullanıcı dokunuşuyla çağrılır: izin iste, servis çalışanını kaydet, abone ol, sunucuya yaz. */
export async function enablePush(): Promise<PushState> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new PushClientError("Bildirim anahtarı sunucuda tanımlı değil. Yöneticinize bildirin.");
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    await saveSubscription(sub);
  } catch (e) {
    if (e instanceof PushClientError) throw e;
    throw new PushClientError("Bildirimler açılamadı. Tarayıcı bildirim hizmetine ulaşamadı, biraz sonra tekrar deneyin.");
  }
  return "on";
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  const { error } = await createClient().rpc("push_unsubscribe", { p_endpoint: endpoint });
  if (error) throw new PushClientError(toUserMessage(error));
}

/** Açılışta: abonelik varsa sunucudaki kaydı tazele (last_seen_at, yenilenmiş anahtar). Sessizdir. */
export async function resyncPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await saveSubscription(sub).catch(() => undefined);
}

export async function fetchPushStatus(): Promise<PushStatus | null> {
  const { data, error } = await createClient().rpc("push_status");
  if (error) return null;
  return parsePushStatus(data);
}

export async function savePushPrefs(callback: boolean, appointment: boolean): Promise<void> {
  const { error } = await createClient().rpc("set_push_prefs", { p_callback: callback, p_appointment: appointment });
  if (error) throw new PushClientError(toUserMessage(error));
}
