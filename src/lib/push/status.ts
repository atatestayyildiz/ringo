export type PushStatus = { devices: number; notify_callback: boolean; notify_appointment: boolean; push_enabled: boolean };

export function parsePushStatus(v: unknown): PushStatus | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    devices: typeof o.devices === "number" ? o.devices : 0,
    notify_callback: o.notify_callback !== false,
    notify_appointment: o.notify_appointment !== false,
    push_enabled: o.push_enabled !== false,
  };
}
