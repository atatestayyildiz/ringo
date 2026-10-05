"use server";

import { revalidatePath } from "next/cache";
import { checkHour, checkMinute } from "@/components/ayarlar/shared";
import type { TablesUpdate } from "@/lib/database.types";
import { toUserMessage } from "@/lib/errors";
import { vapidConfigured } from "@/lib/push/send";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_MANAGER = "Bu işlemi yalnız yönetici yapabilir.";
const LEADS = new Set([30, 60, 120]);

export type TeamPushRow = {
  id: string;
  full_name: string;
  devices: number;
  notify_callback: boolean;
  notify_appointment: boolean;
};

export type NotificationsData = {
  /** Yalnız boolean: değerler istemciye gitmez. */
  vapidConfigured: boolean;
  cronSecretConfigured: boolean;
  appUrlConfigured: boolean;
  team: TeamPushRow[];
};

async function requireManager() {
  const ctx = await getSessionContext();
  return ctx.member.role === "manager" ? ctx : null;
}

export async function loadNotificationsAction(): Promise<Result<{ data: NotificationsData }>> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_team_status");
  if (error) return { ok: false, error: toUserMessage(error) };
  return {
    ok: true,
    data: {
      vapidConfigured: vapidConfigured(),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      appUrlConfigured: Boolean(process.env.APP_URL),
      team: (data ?? [])
        .map((m) => ({
          id: m.member_id,
          full_name: m.full_name,
          devices: m.devices,
          notify_callback: m.notify_callback,
          notify_appointment: m.notify_appointment,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "tr")),
    },
  };
}

/** Mağaza push anahtarı ve randevu hatırlatma süresi (set_push_settings). */
export async function savePushSettingsAction(v: { enabled: boolean; lead: number }): Promise<Result> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  if (!LEADS.has(v.lead)) return { ok: false, error: "Randevu hatırlatma süresi 30, 60 veya 120 dakika olmalı." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_push_settings", { p_enabled: Boolean(v.enabled), p_lead: v.lead });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/ayarlar");
  return { ok: true };
}

/** Dağıtım saati (bildirim değil, dağıtım ayarı). Verilmeyenlere dokunulmaz. */
export async function saveNotificationSettingsAction(v: {
  distribution_hour?: number;
  distribution_minute?: number;
}): Promise<Result> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const patch: TablesUpdate<"tenant_settings"> = {};
  if (v.distribution_hour !== undefined) {
    const err = checkHour(Number(v.distribution_hour), "Sabah listesi saati");
    if (err) return { ok: false, error: err };
    patch.distribution_hour = v.distribution_hour;
  }
  if (v.distribution_minute !== undefined) {
    const err = checkMinute(Number(v.distribution_minute), "Sabah listesi saati");
    if (err) return { ok: false, error: err };
    patch.distribution_minute = v.distribution_minute;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .update(patch)
    .eq("tenant_id", ctx.member.tenant_id)
    .select("tenant_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data || data.length === 0) return { ok: false, error: "Ayarlar kaydedilemedi. Yetkinizi kontrol edip tekrar deneyin." };

  revalidatePath("/ayarlar");
  return { ok: true };
}
