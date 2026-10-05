import Link from "next/link";
import { CallbackReminder } from "@/components/shell/CallbackReminder";
import { MainNav, type NavKey } from "@/components/shell/MainNav";
import { MobileMenu } from "@/components/shell/MobileMenu";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Avatar, ToastProvider } from "@/components/ui";
import { navKeys } from "@/lib/access";
import { isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { member, settings } = await getSessionContext();
  const isManager = member.role === "manager";

  // Etkin vurgu: kişisel seçim ?? (yönetici: marka rengi, satışçı: nötr token)
  const supabase = await createClient();
  const { data: me } = await supabase.from("members").select("accent_color").eq("id", member.id).maybeSingle();
  const personal = me?.accent_color && HEX.test(me.accent_color) ? me.accent_color : null;
  const brandCss = personal ?? (isManager ? (HEX.test(settings.brand_color) ? settings.brand_color : null) : "var(--accent-neutral)");

  // Raporlar herkese (kapsam DB'de), Yönetim yönetici veya view_team, Ayarlar yönetici
  const visible: NavKey[] = navKeys(member);

  const brandName = settings.brand_name;
  const logoUrl = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : null;
  const mark = (brandName.trim()[0] ?? "M").toLocaleUpperCase("tr");

  return (
    <ToastProvider>
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
            <ThemeToggle />
            <Link href="/profil" className="me" aria-label="Profil" style={{ textDecoration: "none", color: "inherit" }}>
              <Avatar name={member.full_name} />
              <div>
                <small>{isManager ? "Yönetici" : "Çalışan"}</small>
                <b>{member.full_name}</b>
              </div>
            </Link>
            <SignOutButton action={signOutAction} />
          </div>
        </div>
      </header>
      <CallbackReminder memberId={member.id} />
      <div className="app">
        <main>{children}</main>
      </div>
    </ToastProvider>
  );
}
