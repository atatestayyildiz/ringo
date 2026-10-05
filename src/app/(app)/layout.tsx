import Link from "next/link";
import { AutoLock } from "@/components/lock/AutoLock";
import { DoorProvider } from "@/components/scene/DoorProvider";
import { CallbackReminder } from "@/components/shell/CallbackReminder";
import { MadeBy } from "@/components/shell/MadeBy";
import { MainNav, type NavKey } from "@/components/shell/MainNav";
import { MobileMenu } from "@/components/shell/MobileMenu";
import { UserMenu } from "@/components/shell/UserMenu";
import { ToastProvider } from "@/components/ui";
import { navKeys } from "@/lib/access";
import { memberAccent } from "@/lib/accent";
import { DEFAULT_LOGO, isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, member, settings } = await getSessionContext();
  const isManager = member.role === "manager";

  // Etkin vurgu: kişisel seçim ?? (yönetici: marka rengi, satışçı: nötr token). Avatar, kapı ve kilit sahnesi de bunu kullanır.
  const brandCss = await memberAccent({ member, settings });

  // Raporlar herkese (kapsam DB'de), Yönetim yönetici veya view_team, Ayarlar yönetici
  const visible: NavKey[] = navKeys(member);

  const brandName = settings.brand_name;
  const logoUrl = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : DEFAULT_LOGO;
  const mark = (brandName.trim()[0] ?? "M").toLocaleUpperCase("tr");

  return (
    <ToastProvider>
      <DoorProvider brandName={brandName} logoUrl={logoUrl}>
      {brandCss ? <style>{`:root{--brand:${brandCss}}`}</style> : null}
      <header className="top">
        <div className="top-in">
          <MobileMenu visible={visible} signOutAction={signOutAction} />
          <Link href="/bugun" className="logo" style={{ textDecoration: "none" }}>
            <span className="logo-mark" aria-hidden="true">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" />
              ) : (
                mark
              )}
            </span>
            <span className="logo-name">{brandName}</span>
          </Link>
          <MainNav visible={visible} />
          <div className="tools">
            <span className="ringo-tag" title="Ringo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ringo-64.png" alt="" aria-hidden="true" width={22} height={22} />
              <span>Ringo</span>
            </span>
            <UserMenu name={member.full_name} roleLabel={isManager ? "Yönetici" : "Çalışan"} signOutAction={signOutAction} />
          </div>
        </div>
      </header>
      <CallbackReminder memberId={member.id} />
      <AutoLock sessionKey={user.last_sign_in_at ?? user.id} />
      <div className="app">
        <main>{children}</main>
        <MadeBy />
      </div>
      </DoorProvider>
    </ToastProvider>
  );
}
