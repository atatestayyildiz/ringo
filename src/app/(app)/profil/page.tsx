import { AccentCard } from "@/components/profil/AccentCard";
import { PasswordCard } from "@/components/profil/PasswordCard";
import { SecurityCard } from "@/components/profil/SecurityCard";
import { PushCard } from "@/components/push/PushCard";
import s from "@/components/profil/profil.module.css";
import { Avatar, Card, Chip } from "@/components/ui";
import { parsePushStatus } from "@/lib/push/status";
import { getSessionContext } from "@/lib/session";
import { parseLockStatus } from "@/components/lock/activity";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Profil" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await getSessionContext();
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("members")
    .select("accent_color")
    .eq("id", ctx.member.id)
    .maybeSingle();
  const { data: pushData } = await supabase.rpc("push_status");
  const { data: lockData } = await supabase.rpc("lock_status");
  const autoLockMinutes = parseLockStatus(lockData)?.auto_lock_minutes ?? 10;

  const isManager = ctx.member.role === "manager";

  return (
    <>
      <div className="page-head">
        <h1>Profil</h1>
        <p>Bildirimler, arayüz rengi ve hesap güvenliği.</p>
      </div>
      <div className={s.bento}>
        <div className={`${s.cell} ${s.who12}`}>
          <Card>
            <div className={s.who}>
              <Avatar name={ctx.member.full_name} size={48} color="var(--brand)" />
              <div>
                <b>{ctx.member.full_name}</b>
                <small>{ctx.user.email}</small>
              </div>
              <Chip>{isManager ? "Yönetici" : "Çalışan"}</Chip>
            </div>
          </Card>
        </div>
        <div className={`${s.cell} ${s.tg}`}>
          <PushCard initial={parsePushStatus(pushData)} />
        </div>
        <div className={`${s.cell} ${s.acc}`}>
          <AccentCard current={me?.accent_color ?? null} brandColor={ctx.settings.brand_color} isManager={isManager} />
        </div>
        <div className={`${s.cell} ${s.pw}`}>
          <PasswordCard />
        </div>
        <div className={`${s.cell} ${s.pw}`}>
          <SecurityCard autoLockMinutes={autoLockMinutes} />
        </div>
      </div>
    </>
  );
}
