import { AccentCard } from "@/components/profil/AccentCard";
import { PasswordCard } from "@/components/profil/PasswordCard";
import { TelegramCard } from "@/components/profil/TelegramCard";
import s from "@/components/profil/profil.module.css";
import { Avatar, Card, Chip } from "@/components/ui";
import { can, getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { botTokenConfigured } from "@/lib/telegram/client";

export const metadata = { title: "Profil" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await getSessionContext();
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("members")
    .select("telegram_linked_at, notify_morning, notify_summary, accent_color")
    .eq("id", ctx.member.id)
    .maybeSingle();

  const isManager = ctx.member.role === "manager";
  const showSummary = isManager || can(ctx.member, "view_reports");

  return (
    <>
      <div className="page-head">
        <h1>Profil</h1>
        <p>Telegram bildirimleri, arayüz rengi ve hesap güvenliği.</p>
      </div>
      <div className={s.cols}>
        <div className={s.stack}>
          <TelegramCard
            linked={me?.telegram_linked_at != null}
            linkedAt={me?.telegram_linked_at ?? null}
            botUsername={ctx.settings.telegram_bot_username}
            tenantEnabled={ctx.settings.telegram_enabled}
            botConfigured={botTokenConfigured()}
            prefs={{
              morning: me?.notify_morning ?? true,
              summary: me?.notify_summary ?? true,
            }}
            showSummary={showSummary}
          />
        </div>
        <div className={s.stack}>
          <Card>
            <div className={s.who}>
              <Avatar name={ctx.member.full_name} size={48} />
              <div>
                <b>{ctx.member.full_name}</b>
                <small>{ctx.user.email}</small>
              </div>
              <Chip>{isManager ? "Yönetici" : "Çalışan"}</Chip>
            </div>
          </Card>
          <AccentCard current={me?.accent_color ?? null} brandColor={ctx.settings.brand_color} isManager={isManager} />
          <PasswordCard />
        </div>
      </div>
    </>
  );
}
