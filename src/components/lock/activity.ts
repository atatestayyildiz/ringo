/**
 * Panel kilidi istemci yardımcıları: tüm sekmelerde ortak son etkinlik zamanı (localStorage)
 * ve sekmeler arası kilit mesajları (BroadcastChannel). Depolama kapalıysa bellek içi değer kullanılır.
 */

export const LOCK_CHANNEL = "telefoncu-lock";
const ACTIVITY_KEY = "telefoncu-last-activity";

/** sid: oturum anahtarı (son şifreli giriş zamanı). Yeni girişte eski zaman sayılmaz. */
export type Activity = { sid: string; t: number };

export type LockMessage =
  | { type: "locked"; from: string }
  | { type: "unlocked"; from: string }
  | { type: "minutes"; from: string; minutes: number; mobile: boolean };

/** Bu sekmenin kimliği: kendi gönderdiği mesajı yok saymak için. */
export const TAB_ID = Math.random().toString(36).slice(2);

let memory: Activity | null = null;

export function readActivity(): Activity | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Activity>;
      if (typeof v.t === "number" && typeof v.sid === "string") return { sid: v.sid, t: v.t };
    }
  } catch {
    // depolama kapalı ya da bozuk değer
  }
  return memory;
}

export function writeActivity(a: Activity) {
  memory = a;
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(a));
  } catch {
    // depolama kapalı olabilir
  }
}

/** Etkinliği şimdi olarak işaretler (oturum anahtarı korunur). Kilit açılınca çağrılır. */
export function markActivity() {
  writeActivity({ sid: readActivity()?.sid ?? "", t: Date.now() });
}

export function postLockMessage(msg: LockMessage) {
  try {
    const ch = new BroadcastChannel(LOCK_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    // BroadcastChannel yoksa diğer sekmeler görünür olunca lock_status ile yakalar
  }
}

/** Kilit mesajlarını dinler; kendi sekmesinin mesajlarını süzer. Aboneliği kaldıran fonksiyon döner. */
export function onLockMessage(cb: (msg: LockMessage) => void): () => void {
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(LOCK_CHANNEL);
  } catch {
    return () => {};
  }
  ch.onmessage = (e: MessageEvent<LockMessage>) => {
    if (e.data && typeof e.data === "object" && e.data.from !== TAB_ID) cb(e.data);
  };
  return () => ch?.close();
}

export const AUTO_LOCK_EVENT = "telefoncu-autolock-change";

/** Telefon/tablet gibi dokunmatik birincil işaretçili cihaz: otomatik kilit için ayrı süre kullanılır. */
export function isTouchDevice(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Otomatik kilit süresi değişti: bu sekmeye (olay) ve diğer sekmelere (kanal) bildirir. mobile: telefon ayarı mı. */
export function notifyAutoLockChanged(minutes: number, mobile = false) {
  window.dispatchEvent(new CustomEvent<{ minutes: number; mobile: boolean }>(AUTO_LOCK_EVENT, { detail: { minutes, mobile } }));
  postLockMessage({ type: "minutes", from: TAB_ID, minutes, mobile });
}

/** lock_status() jsonb sonucunu güvenle çözer; üyelik yoksa null. */
export type LockStatus = { locked: boolean; has_pin: boolean; pin_length: number; auto_lock_minutes: number; auto_lock_minutes_mobile: number };
export function parseLockStatus(v: unknown): LockStatus | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    locked: o.locked === true,
    has_pin: o.has_pin === true,
    pin_length: typeof o.pin_length === "number" && o.pin_length >= 4 && o.pin_length <= 8 ? o.pin_length : 6,
    auto_lock_minutes: typeof o.auto_lock_minutes === "number" ? o.auto_lock_minutes : 0,
    auto_lock_minutes_mobile: typeof o.auto_lock_minutes_mobile === "number" ? o.auto_lock_minutes_mobile : 0,
  };
}
