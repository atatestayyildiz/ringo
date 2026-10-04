import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type Member = Pick<
  Database["public"]["Tables"]["members"]["Row"],
  "id" | "full_name" | "role" | "permissions" | "tenant_id"
>;
export type TenantSettings = Database["public"]["Tables"]["tenant_settings"]["Row"];

export type SessionContext = {
  user: User;
  member: Member;
  settings: TenantSettings;
};

export type Permission =
  | "view_all_customers"
  | "import_customers"
  | "reassign"
  | "export"
  | "view_reports"
  | "delete_customers";

/** manager her zaman true; agent için permissions jsonb anahtarı. */
export function can(member: Pick<Member, "role" | "permissions">, perm: Permission): boolean {
  if (member.role === "manager") return true;
  const p = member.permissions as Record<string, unknown> | null;
  return p?.[perm] === true;
}

/** Oturum, üyelik ve kiracı ayarı. Eksikse çıkış yaptırıp /giris'e yönlendirir. */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect("/giris");

  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, role, permissions, tenant_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || !member.is_active) {
    await supabase.auth.signOut();
    redirect("/giris?hata=uye");
  }

  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("*")
    .eq("tenant_id", member.tenant_id)
    .maybeSingle();

  if (!settings) {
    await supabase.auth.signOut();
    redirect("/giris?hata=uye");
  }

  const { is_active: _active, ...m } = member;
  void _active;
  return { user, member: m, settings };
});

/** Sayfa seviyesi koruma: yetkisizse /bugun'a yönlendirir. */
export async function requireAccess(check: (ctx: SessionContext) => boolean): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!check(ctx)) redirect("/bugun");
  return ctx;
}
