import Link from "next/link";
import { IconLogout } from "@/components/icons";
import { MainNav, type NavKey } from "@/components/shell/MainNav";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Avatar, RoundButton, ToastProvider } from "@/components/ui";
import { can, getSessionContext } from "@/lib/session";
import { signOutAction } from "./actions";

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { member, settings } = await getSessionContext();
  const isManager = member.role === "manager";

  const visible: NavKey[] = ["bugun", "musteriler", "havuz", "huni"];
  if (isManager || can(member, "view_reports")) visible.push("yonetim", "raporlar");
  if (isManager) visible.push("ayarlar");

  const brandName = settings.brand_name;
  const mark = (brandName.trim()[0] ?? "M").toLocaleUpperCase("tr");

  return (
    <ToastProvider>
      {HEX.test(settings.brand_color) ? <style>{`:root{--brand:${settings.brand_color}}`}</style> : null}
      <div className="app">
        <header className="top">
          <Link href="/bugun" className="logo" style={{ textDecoration: "none" }}>
            <span className="logo-mark" aria-hidden="true">
              {settings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logo_url} alt="" />
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
            <form action={signOutAction}>
              <RoundButton label="Çıkış yap" type="submit">
                <IconLogout />
              </RoundButton>
            </form>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </ToastProvider>
  );
}
