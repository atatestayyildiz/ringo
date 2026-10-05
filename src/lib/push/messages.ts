// Saf mesaj üreticileri: payload -> Türkçe bildirim. Telefon numarası bildirime girmez.

export type PushMessage = { title: string; body: string; url: string; tag: string };

export type TargetKind = "callback" | "appointment";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** "Esra", "U" -> "Esra U." */
function who(p: Record<string, unknown>): string {
  const first = str(p.first_name);
  const initial = str(p.last_initial).slice(0, 1);
  return [first, initial ? `${initial}.` : ""].filter(Boolean).join(" ");
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

export function callbackMessage(payload: unknown, refId?: string): PushMessage {
  const p = payloadObject(payload);
  const at = str(p.at);
  return {
    title: "Geri arama vakti",
    body: `${who(p)} için ${at} aramasının vakti geldi.`,
    url: "/bugun",
    tag: `callback-${refId ?? at}`,
  };
}

export function appointmentMessage(payload: unknown, refId?: string): PushMessage {
  const p = payloadObject(payload);
  const time = str(p.time);
  return {
    title: "Randevu hatırlatma",
    body: `${time} ${who(p)} dükkana gelecek.`,
    url: "/bugun",
    tag: `appointment-${refId ?? time}`,
  };
}

export function testMessage(): PushMessage {
  return { title: "Ringo test bildirimi", body: "Bildirimler bu cihazda çalışıyor.", url: "/bugun", tag: "test" };
}

export function messageFor(kind: string, payload: unknown, refId?: string): PushMessage | null {
  if (kind === "callback") return callbackMessage(payload, refId);
  if (kind === "appointment") return appointmentMessage(payload, refId);
  return null;
}
