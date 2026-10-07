"use server";

import { revalidatePath } from "next/cache";
import { toUserMessage } from "@/lib/errors";
import { createGraph, describeError } from "@/lib/meta/graph";
import { syncCooldownError } from "@/lib/meta/cooldown";
import { parseMetaStatus, type MetaStatus } from "@/lib/meta/status";
import { syncConnections } from "@/lib/meta/sync";
import { getSessionContext } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_MANAGER = "Bu işlemi yalnız yönetici yapabilir.";

export type MetaData = {
  /** Yalnız VAR/YOK: değerler istemciye gitmez. */
  env: { appSecret: boolean; verifyToken: boolean; accessToken: boolean; pageId: boolean };
  status: MetaStatus;
};

async function requireManager() {
  const ctx = await getSessionContext();
  return ctx.member.role === "manager" ? ctx : null;
}

export async function loadMetaAction(): Promise<Result<{ data: MetaData }>> {
  if (!(await requireManager())) return { ok: false, error: NOT_MANAGER };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meta_status");
  if (error) return { ok: false, error: toUserMessage(error) };
  return {
    ok: true,
    data: {
      env: {
        appSecret: Boolean(process.env.META_APP_SECRET),
        verifyToken: Boolean(process.env.META_VERIFY_TOKEN),
        accessToken: Boolean(process.env.META_ACCESS_TOKEN),
        pageId: Boolean(process.env.META_PAGE_ID),
      },
      status: parseMetaStatus(data),
    },
  };
}

/**
 * Önce yönetici ve panel kilidi DB'de doğrulanır (meta_status, kullanıcı oturumuyla), sonra sayfa token'ı alınıp
 * sayfa `leadgen` alanına abone edilir, en son sayfa kimliği YALNIZ ortam değişkeninden `meta_connect_for` ile yazılır.
 */
export async function connectMetaAction(): Promise<Result> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const pageId = process.env.META_PAGE_ID?.trim();
  if (!token || !pageId) return { ok: false, error: "Sunucuda Meta ayarları eksik. Kurulum rehberine bakın." };
  const supabase = await createClient();
  const gate = await supabase.rpc("meta_status");
  if (gate.error) return { ok: false, error: toUserMessage(gate.error) };
  try {
    const graph = createGraph(token);
    const pageToken = await graph.pageToken(pageId);
    await graph.subscribe(pageId, pageToken);
  } catch (e) {
    console.error("[meta] bağlantı kurulamadı:", e instanceof Error ? e.name : "hata");
    return { ok: false, error: describeError(e) };
  }
  const { error } = await createAdminClient().rpc("meta_connect_for", { p_tenant: ctx.member.tenant_id, p_page_id: pageId });
  if (error) return { ok: false, error: toUserMessage(error) };
  revalidatePath("/ayarlar");
  return { ok: true };
}

/** Yöneticinin kendi bağlantısı için son 7 günü tarar. */
export async function syncMetaAction(): Promise<Result<{ message: string }>> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const token = process.env.META_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, error: "Sunucuda Meta ayarları eksik. Kurulum rehberine bakın." };
  const supabase = await createClient();
  const st = await supabase.rpc("meta_status");
  if (st.error) return { ok: false, error: toUserMessage(st.error) };
  const status = parseMetaStatus(st.data);
  if (!status.connected || !status.page_id) return { ok: false, error: "Önce bağlantıyı kurun." };
  const wait = syncCooldownError(status.last_sync_at);
  if (wait) return { ok: false, error: wait };

  let sum;
  try {
    sum = await syncConnections(
      createAdminClient(),
      createGraph(token),
      [{ tenant_id: ctx.member.tenant_id, page_id: status.page_id, last_sync_at: status.last_sync_at }],
      { hours: 168 },
    );
  } catch {
    return { ok: false, error: "Tarama yapılamadı. Sunucu yapılandırmasını kontrol edin." };
  }
  revalidatePath("/ayarlar");
  if (sum.failed > 0) return { ok: false, error: "Tarama tamamlanamadı. Durum kartındaki son hata satırına bakın." };
  return { ok: true, message: `${sum.leads} başvuru tarandı, ${sum.inserted + sum.reopened} müşteri eklendi ya da yeniden açıldı.` };
}
