import { NextResponse } from "next/server";
import { can, type Member } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ExportAuth =
  | { ok: true; supabase: Supabase; member: Member }
  | { ok: false; response: NextResponse };

const json = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Oturumu ve yetkiyi sunucuda doğrular: 401 oturum yok, 403 yetki yok. */
export async function authorizeExport(
  extra?: (m: Member) => boolean,
  extraMessage = "Bu işlem için yetkiniz yok.",
): Promise<ExportAuth> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, response: json(401, "Oturum bulunamadı.") };

  const { data: member } = await supabase
    .from("members")
    .select("id, full_name, role, permissions, tenant_id, is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!member || !member.is_active) return { ok: false, response: json(403, "Bu işlem için yetkiniz yok.") };

  if (!can(member, "export")) return { ok: false, response: json(403, "Dışa aktarma yetkiniz yok.") };
  if (extra && !extra(member)) return { ok: false, response: json(403, extraMessage) };

  return { ok: true, supabase, member };
}

export function csvResponse(body: string, filename: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
