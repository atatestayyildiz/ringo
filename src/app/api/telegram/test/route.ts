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
    .select("id, tenant_id, full_name, telegram_linked_at")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !m) return Response.json({ ok: false, error: toUserMessage(error) }, { status: 400 });
  if (m.telegram_linked_at === null) {
    return Response.json({ ok: false, error: "Önce Telegram hesabını bağla." }, { status: 400 });
  }

  // Sohbet kimliği istemci rolüne kapalı (D1); üye oturumla doğrulandıktan sonra sunucuda okunur.
  const admin = createAdminClient();
  const { data: chat, error: chatErr } = await admin
    .from("members")
    .select("telegram_chat_id")
    .eq("id", m.id)
    .maybeSingle();
  if (chatErr) {
    console.error("[telegram] sohbet kimliği okunamadı:", chatErr.message);
    return Response.json({ ok: false, error: "Mesaj gönderilemedi. Biraz sonra tekrar dene." }, { status: 500 });
  }
  const chatId = chat?.telegram_chat_id ?? null;
  if (chatId === null) {
    return Response.json({ ok: false, error: "Önce Telegram hesabını bağla." }, { status: 400 });
  }

  // Üye başına dakikada 1 test mesajı: önce sahiplen, sınırdaysa gönderme
  const claim = await admin.rpc("_notification_claim", {
    p_tenant: m.tenant_id,
    p_member: m.id,
    p_kind: "test",
    p_day: istanbulDay(new Date()),
  });
  if (claim.error) {
    console.error("[telegram] test kaydı açılamadı:", claim.error.message);
    return Response.json({ ok: false, error: "Mesaj gönderilemedi. Biraz sonra tekrar dene." }, { status: 500 });
  }
  if (claim.data === null || claim.data === undefined) {
    return Response.json({ ok: false, error: "Test mesajı dakikada bir gönderilebilir. Biraz bekleyip tekrar dene." }, { status: 429 });
  }

  const first = m.full_name.trim().split(/\s+/)[0] ?? "";
  let status: "sent" | "failed" = "sent";
  let err: string | null = null;
  try {
    await sendMessage(chatId, testText(first));
  } catch (e) {
    status = "failed";
    err = e instanceof Error ? e.message : "bilinmeyen hata";
    console.error("[telegram] test mesajı gönderilemedi:", err);
  }

  const fin = await admin.rpc("_notification_finish", { p_id: claim.data, p_status: status, p_error: err as string });
  if (fin.error) console.error("[telegram] test kaydı yazılamadı:", fin.error.message);

  if (status === "failed") {
    return Response.json({ ok: false, error: "Mesaj gönderilemedi. Botu Telegram'da başlattığından emin ol." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
