import { SettingsTabs } from "@/components/ayarlar/SettingsTabs";
import type { MemberRow, PermKey } from "@/components/ayarlar/shared";
import { Card, EmptyState } from "@/components/ui";
import { loadErrorText } from "@/lib/errors";
import { requireAccess } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { botTokenConfigured } from "@/lib/telegram/client";
import { listAuthEmails } from "./_server/admin";

export const metadata = { title: "Ayarlar" };

export default async function Page() {
  const ctx = await requireAccess(({ member }) => member.role === "manager");
  const supabase = await createClient();

  const [membersRes, summaryRes, meRes] = await Promise.all([
    supabase
      .from("members")
      .select("id, user_id, full_name, role, is_active, permissions")
      .order("is_active", { ascending: false })
      .order("full_name"),
    supabase.rpc("rules_summary_text"),
    supabase
      .from("members")
      .select("telegram_linked_at, notify_morning, notify_summary")
      .eq("id", ctx.member.id)
      .maybeSingle(),
  ]);
  const me = meRes.data;

  let emails = new Map<string, string>();
  let emailWarning: string | null = null;
  try {
    emails = await listAuthEmails();
  } catch {
    emailWarning = "E-postalar okunamadı. Sunucu yapılandırmasını (service role anahtarı) kontrol edin.";
  }

  if (membersRes.error) {
    console.error("[ayarlar] üyeler okunamadı:", membersRes.error.code ?? membersRes.error.message);
    return (
      <>
        <div className="page-head">
          <h1>Ayarlar</h1>
        </div>
        <Card>
          <EmptyState title="Ayarlar yüklenemedi">{loadErrorText(membersRes.error)}</EmptyState>
        </Card>
      </>
    );
  }

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    full_name: m.full_name,
    email: emails.get(m.user_id) ?? "",
    role: m.role === "manager" ? "manager" : "agent",
    is_active: m.is_active,
    permissions: (m.permissions ?? {}) as Partial<Record<PermKey, boolean>>,
    isSelf: m.id === ctx.member.id,
  }));

  return (
    <>
      <div className="page-head">
        <h1>Ayarlar</h1>
        <p>Arama kuralları, ekip ve marka.</p>
      </div>
      <SettingsTabs
        settings={ctx.settings}
        summary={summaryRes.data ?? ""}
        members={members}
        emailWarning={emailWarning}
        selfTelegram={{
          linked: me?.telegram_linked_at != null,
          linkedAt: me?.telegram_linked_at ?? null,
          botConfigured: botTokenConfigured(),
          prefs: { morning: me?.notify_morning ?? true, summary: me?.notify_summary ?? true },
        }}
      />
    </>
  );
}
