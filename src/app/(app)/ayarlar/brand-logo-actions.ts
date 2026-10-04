"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/ayarlar/shared";
import { LOGO_BUCKET, LOGO_MAX_BYTES, ownLogoPath, validateLogoFile } from "@/lib/brand-logo";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const NOT_MANAGER = "Bu işlemi yalnız yönetici yapabilir.";

async function requireManager() {
  const ctx = await getSessionContext();
  if (ctx.member.role !== "manager") return null;
  return ctx;
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Eski logo bizim depodaysa ve kendi kiracımıza aitse siler; hata kullanıcıyı durdurmaz. */
async function removeOldLogo(supabase: Supabase, tenantId: string, oldUrl: string | null | undefined) {
  const path = ownLogoPath(oldUrl, supabaseUrl(), tenantId);
  if (!path) return;
  const { error } = await supabase.storage.from(LOGO_BUCKET).remove([path]);
  if (error) console.error("[logo] eski dosya silinemedi:", error.message);
}

export async function uploadLogoAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Bir dosya seçin." };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "Logo en fazla 512 KB olabilir." };

  // Sınır, bildirilen boyuta değil gerçekten okunan bayta uygulanır.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateLogoFile(bytes, file.type || undefined);
  if (!check.ok) return { ok: false, error: check.error };

  const tenantId = ctx.member.tenant_id;
  const supabase = await createClient();

  const { data: current } = await supabase.from("tenant_settings").select("logo_url").eq("tenant_id", tenantId).maybeSingle();

  const path = `${tenantId}/logo-${randomUUID()}.${check.ext}`;
  const up = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes, {
    contentType: check.mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (up.error) {
    console.error("[logo] yükleme hatası:", up.error.message);
    return { ok: false, error: "Logo yüklenemedi. Lütfen tekrar deneyin." };
  }

  const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data, error } = await supabase
    .from("tenant_settings")
    .update({ logo_url: url })
    .eq("tenant_id", tenantId)
    .select("tenant_id");
  if (error || !data || data.length === 0) {
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    return { ok: false, error: error ? toUserMessage(error) : "Logo kaydedilemedi. Yetkinizi kontrol edip tekrar deneyin." };
  }

  await removeOldLogo(supabase, tenantId, current?.logo_url);
  revalidatePath("/", "layout");
  return { ok: true, url };
}

export async function removeLogoAction(): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const tenantId = ctx.member.tenant_id;
  const supabase = await createClient();
  const { data: current } = await supabase.from("tenant_settings").select("logo_url").eq("tenant_id", tenantId).maybeSingle();

  const { data, error } = await supabase
    .from("tenant_settings")
    .update({ logo_url: null })
    .eq("tenant_id", tenantId)
    .select("tenant_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data || data.length === 0) return { ok: false, error: "Logo kaldırılamadı. Yetkinizi kontrol edip tekrar deneyin." };

  await removeOldLogo(supabase, tenantId, current?.logo_url);
  revalidatePath("/", "layout");
  return { ok: true };
}
