import { toUserMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { botTokenConfigured, sendMessage } from "@/lib/telegram/client";
import { istanbulDay } from "@/lib/telegram/notify";
import { testText } from "@/lib/telegram/messages";

export const dynamic = "force-dynamic";

/** Oturumlu üye kendine test mesajı gönderir (kind='test'). */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ ok: false, error: "Oturum gerekli." }, { status: 401 });

  if (!botTokenConfigured()) {
    return Response.json({ ok: false, error: "Bot henüz kurulmadı." }, { status: 503 });
  }

  const { data: m, error } = await supabase
    .from("members")
    .select("id, tenant_id, full_name, telegram_chat_id")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !m) return Response.json({ ok: false, error: toUserMessage(error) }, { status: 400 });
  if (m.telegram_chat_id === null) {
    return Response.json({ ok: false, error: "Önce Telegram hesabını bağla." }, { status: 400 });
  }

  const first = m.full_name.trim().split(/\s+/)[0] ?? "";
  let status: "sent" | "failed" = "sent";
  let err: string | null = null;
  try {
    await sendMessage(m.telegram_chat_id, testText(first));
  } catch (e) {
    status = "failed";
    err = e instanceof Error ? e.message : "bilinmeyen hata";
    console.error("[telegram] test mesajı gönderilemedi:", err);
  }

  try {
    await createAdminClient().rpc("_notification_record", {
      p_tenant: m.tenant_id,
      p_member: m.id,
      p_kind: "test",
      p_day: istanbulDay(new Date()),
      p_status: status,
      p_error: err as string,
    });
  } catch (e) {
    console.error("[telegram] test kaydı yazılamadı:", e instanceof Error ? e.message : "bilinmeyen hata");
  }

  if (status === "failed") {
    return Response.json({ ok: false, error: "Mesaj gönderilemedi. Botu Telegram'da başlattığından emin ol." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
