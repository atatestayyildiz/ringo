import { signOutAction } from "@/app/(app)/actions";
import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import s from "@/components/lock/lock.module.css";
import { Scene } from "@/components/scene/Scene";
import { isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { PinSetup } from "./PinSetup";

export const metadata = { title: "PIN belirle" };
export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** İlk girişte zorunlu PIN belirleme (proxy PIN'i olmayanı başka yere geçirmez). */
export default async function PinSetupPage() {
  const { settings } = await getSessionContext();
  const color = HEX.test(settings.brand_color) ? settings.brand_color : null;
  const logo = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : null;
  return (
    <>
      {color ? <style>{`:root{--brand:${color}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }}>
        <ThemeToggle />
      </div>
      <Scene mode="lock" brandName={settings.brand_name} brandColor={color} logoUrl={logo}>
        <PinSetup>
          <form action={signOutAction}>
            <button type="submit" className={s.link}>
              Çıkış yap
            </button>
          </form>
        </PinSetup>
        <MadeBy />
      </Scene>
    </>
  );
}
