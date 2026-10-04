"use server";

import { revalidatePath } from "next/cache";
import {
  HEX_RE,
  PERM_KEYS,
  checkRule,
  RULE_LIMITS,
  type ActionResult,
  type PermKey,
  type RulesValues,
} from "@/components/ayarlar/shared";
import { isAllowedLogoUrl } from "@/lib/brand-logo";
import { toUserMessage } from "@/lib/errors";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "./_server/admin";

const NOT_MANAGER = "Bu işlemi yalnız yönetici yapabilir.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireManager() {
  const ctx = await getSessionContext();
  if (ctx.member.role !== "manager") return null;
  return ctx;
}

/* ---------------- Kurallar ---------------- */

export async function saveRulesAction(v: RulesValues): Promise<ActionResult<{ summary: string }>> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  for (const key of Object.keys(RULE_LIMITS) as (keyof typeof RULE_LIMITS)[]) {
    const err = checkRule(key, Number(v[key]));
    if (err) return { ok: false, error: err };
  }
  if (v.distribution_mode !== "auto_even") {
    return { ok: false, error: "Şimdilik yalnız otomatik eşit dağıtım seçilebilir." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .update({
      max_attempts: v.max_attempts,
      pool_wait_days: v.pool_wait_days,
      max_rounds: v.max_rounds,
      distribution_hour: v.distribution_hour,
      summary_hour: v.summary_hour,
      birthday_notice_days: v.birthday_notice_days,
      distribution_mode: v.distribution_mode,
    })
    .eq("tenant_id", ctx.member.tenant_id)
    .select("tenant_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data || data.length === 0) return { ok: false, error: "Kurallar kaydedilemedi. Yetkinizi kontrol edip tekrar deneyin." };

  const { data: summary } = await supabase.rpc("rules_summary_text");
  revalidatePath("/ayarlar");
  revalidatePath("/bugun");
  return { ok: true, summary: summary ?? "" };
}

/* ---------------- Marka ---------------- */

export async function saveBrandAction(v: {
  brand_name: string;
  brand_color: string;
  logo_url: string;
}): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const name = v.brand_name.trim();
  if (!name || name.length > 60) return { ok: false, error: "Marka adı 1 ile 60 karakter arasında olmalı." };
  if (!HEX_RE.test(v.brand_color)) return { ok: false, error: "Renk #RRGGBB biçiminde olmalı, örneğin #FF5E2B." };
  const logo = v.logo_url.trim();
  if (logo) {
    // https adresi ya da bu uygulamanın kendi logo deposu (yerelde http olabilir).
    const ok = isAllowedLogoUrl(logo, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!ok) return { ok: false, error: "Logo adresi https:// ile başlayan geçerli bir bağlantı olmalı." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_settings")
    .update({ brand_name: name, brand_color: v.brand_color.toUpperCase(), logo_url: logo || null })
    .eq("tenant_id", ctx.member.tenant_id)
    .select("tenant_id");
  if (error) return { ok: false, error: toUserMessage(error) };
  if (!data || data.length === 0) return { ok: false, error: "Marka kaydedilemedi. Yetkinizi kontrol edip tekrar deneyin." };

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------------- Ekip ---------------- */

export async function createMemberAction(v: {
  full_name: string;
  email: string;
  password: string;
  role: "manager" | "agent";
}): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };

  const fullName = v.full_name.trim();
  const email = v.email.trim().toLowerCase();
  if (fullName.length < 2) return { ok: false, error: "Ad soyad en az 2 karakter olmalı." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Geçerli bir e-posta adresi girin." };
  if (v.password.length < 8) return { ok: false, error: "Geçici şifre en az 8 karakter olmalı." };
  if (v.role !== "manager" && v.role !== "agent") return { ok: false, error: "Geçersiz rol." };

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email, password: v.password, email_confirm: true });
  if (created.error || !created.data.user) {
    // E-postanın başka bir hesapta kayıtlı olup olmadığını sızdırmayan genel mesaj
    return { ok: false, error: "Çalışan eklenemedi. Bilgileri kontrol edip tekrar deneyin veya başka bir e-posta deneyin." };
  }
  const userId = created.data.user.id;

  const { error: insErr } = await admin.from("members").insert({
    tenant_id: ctx.member.tenant_id,
    user_id: userId,
    full_name: fullName,
    role: v.role,
    permissions: {},
    is_active: true,
  });
  if (insErr) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: `Çalışan eklenemedi, hesap geri alındı. ${toUserMessage(insErr)}` };
  }

  revalidatePath("/ayarlar");
  return { ok: true };
}

async function activeManagerCount(tenantId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("role", "manager")
    .eq("is_active", true);
  return count ?? 0;
}

async function loadTarget(tenantId: string, memberId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("members")
    .select("id, role, is_active, permissions")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

export async function setMemberActiveAction(memberId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  const target = await loadTarget(ctx.member.tenant_id, memberId);
  if (!target) return { ok: false, error: "Çalışan bulunamadı. Sayfayı yenileyin." };

  if (!active) {
    if (target.id === ctx.member.id) return { ok: false, error: "Kendinizi pasifleştiremezsiniz." };
    if (target.role === "manager" && target.is_active && (await activeManagerCount(ctx.member.tenant_id)) <= 1) {
      return { ok: false, error: "Son aktif yöneticiyi pasifleştiremezsiniz. Önce başka bir yönetici atayın." };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ is_active: active })
    .eq("id", memberId)
    .eq("tenant_id", ctx.member.tenant_id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: error ? toUserMessage(error) : "Güncellenemedi. Yetkiniz olmayabilir." };
  revalidatePath("/ayarlar");
  return { ok: true };
}

export async function setMemberRoleAction(memberId: string, role: "manager" | "agent"): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  if (role !== "manager" && role !== "agent") return { ok: false, error: "Geçersiz rol." };
  const target = await loadTarget(ctx.member.tenant_id, memberId);
  if (!target) return { ok: false, error: "Çalışan bulunamadı. Sayfayı yenileyin." };

  if (role === "agent" && target.role === "manager") {
    if (target.id === ctx.member.id) return { ok: false, error: "Kendi rolünüzü düşüremezsiniz. Başka bir yönetici yapsın." };
    if (target.is_active && (await activeManagerCount(ctx.member.tenant_id)) <= 1) {
      return { ok: false, error: "Son aktif yöneticinin rolü değiştirilemez." };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ role })
    .eq("id", memberId)
    .eq("tenant_id", ctx.member.tenant_id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: error ? toUserMessage(error) : "Rol değiştirilemedi. Yetkiniz olmayabilir." };
  revalidatePath("/ayarlar");
  return { ok: true };
}

export async function setPermissionAction(memberId: string, key: PermKey, value: boolean): Promise<ActionResult> {
  const ctx = await requireManager();
  if (!ctx) return { ok: false, error: NOT_MANAGER };
  if (!PERM_KEYS.includes(key)) return { ok: false, error: "Geçersiz yetki." };
  const target = await loadTarget(ctx.member.tenant_id, memberId);
  if (!target) return { ok: false, error: "Çalışan bulunamadı. Sayfayı yenileyin." };

  const current = (target.permissions ?? {}) as Record<string, unknown>;
  const next = { ...current, [key]: value };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .update({ permissions: next as never })
    .eq("id", memberId)
    .eq("tenant_id", ctx.member.tenant_id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: error ? toUserMessage(error) : "Yetki kaydedilemedi. Yetkiniz olmayabilir." };
  revalidatePath("/ayarlar");
  return { ok: true };
}
