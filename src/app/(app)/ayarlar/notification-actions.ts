"use server";

import { revalidatePath } from "next/cache";
import { checkHour } from "@/components/ayarlar/shared";
import type { TablesUpdate } from "@/lib/database.types";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { botTokenConfigured } from "@/lib/telegram/client";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_MANAGER = "Bu işlemi yalnız yönetici yapabilir.";
const BOT_RE = /^[A-Za-z0-9_]{3,64}$/;

export type TeamTelegramRow = { id: string; full_name: string; role: string; linked: boolean; linkedAt: string | null };

export type NotificationsData = {
  /** Yalnız boolean: değerler istemciye gitmez. */
  botConfigured: boolean;
  webhookSecretConfigured: boolean;
  cronSecretConfigured: boolean;
  appUrl: string;
  team: TeamTelegramRow[];
};

async function requireManager() {
  const ctx = await getSessionContext();
  return ctx.member.role === "manager" ? ctx : null;
}

export async function loadNotificationsAction(): Promise<Result<{ data: NotificationsData }>> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, full_name, role, is_active, telegram_linked_at")
    .eq("is_active", true)
    .order("full_name");
  if (error) return { ok: false, error: toUserMessage(error) };
  return {
    ok: true,
    data: {
      botConfigured: botTokenConfigured(),
      webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      appUrl: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
      team: (data ?? []).map((m) => ({
        id: m.id,
        full_name: m.full_name,
        role: m.role,
        linked: m.telegram_linked_at !== null,
        linkedAt: m.telegram_linked_at,
      })),
    },
  };
}

/** Verilen alanlar güncellenir; verilmeyenlere dokunulmaz. */
export async function saveNotificationSettingsAction(v: {
  telegram_enabled?: boolean;
  telegram_bot_username?: string;
  distribution_hour?: number;
  summary_hour?: number;
}): Promise<Result> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const patch: TablesUpdate<"tenant_settings"> = {};
  if (v.telegram_enabled !== undefined) patch.telegram_enabled = Boolean(v.telegram_enabled);
  if (v.telegram_bot_username !== undefined) {
    const bot = v.telegram_bot_username.trim().replace(/^@/, "");
    if (bot !== "" && !BOT_RE.test(bot)) {
      return { ok: false, error: "Bot kullanıcı adı 3 ile 64 arası harf, rakam veya alt çizgi olmalı." };
    }
    patch.telegram_bot_username = bot === "" ? null : bot;
  }
  if (v.distribution_hour !== undefined) {
    const err = checkHour(Number(v.distribution_hour), "Sabah listesi saati");
    if (err) return { ok: false, error: err };
    patch.distribution_hour = v.distribution_hour;
  }
  if (v.summary_hour !== undefined) {
    const err = checkHour(Number(v.summary_hour), "Akşam özeti saati");
    if (err) return { ok: false, error: err };
    patch.summary_hour = v.summary_hour;
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
  revalidatePath("/profil");
  return { ok: true };
}

export async function unlinkMemberTelegramAction(memberId: string): Promise<Result> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const supabase = await createClient();
  const { error } = await supabase.rpc("telegram_unlink", { p_member: memberId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/ayarlar");
  return { ok: true };
}
