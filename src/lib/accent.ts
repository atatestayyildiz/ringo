import "server-only";
import type { SessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Oturum sahibinin etkin vurgu rengi (CSS değeri): kişisel seçim (members.accent_color) ??
 * yönetici: mağaza rengi, satışçı: nötr token. Panel düzeni, kilit ve PIN belirleme ekranı ortak.
 * null: geçerli renk yok, varsayılan --brand kalır.
 */
export async function memberAccent({ member, settings }: Pick<SessionContext, "member" | "settings">): Promise<string | null> {
  const supabase = await createClient();
  const { data: me } = await supabase.from("members").select("accent_color").eq("id", member.id).maybeSingle();
  const personal = me?.accent_color && HEX.test(me.accent_color) ? me.accent_color : null;
  if (personal) return personal;
  if (member.role === "manager") return HEX.test(settings.brand_color) ? settings.brand_color : null;
  return "var(--accent-neutral)";
}
