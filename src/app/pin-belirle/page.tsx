import { signOutAction } from "@/app/(app)/actions";
import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import s from "@/components/lock/lock.module.css";
import { Scene } from "@/components/scene/Scene";
import { memberAccent } from "@/lib/accent";
import { DEFAULT_LOGO, isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { PinSetup } from "./PinSetup";

export const metadata = { title: "PIN belirle" };
export const dynamic = "force-dynamic";

/** İlk girişte zorunlu PIN belirleme (proxy PIN'i olmayanı başka yere geçirmez). Renk: kişisel vurgu kuralı. */
export default async function PinSetupPage() {
  const ctx = await getSessionContext();
  const { settings } = ctx;
  const accent = await memberAccent(ctx);
  const logo = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : DEFAULT_LOGO;
  return (
    <>
      {accent ? <style>{`:root{--brand:${accent}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }}>
        <ThemeToggle />
      </div>
      <Scene mode="lock" brandName={settings.brand_name} logoUrl={logo} footer={<MadeBy />}>
        <PinSetup>
          <form action={signOutAction}>
            <button type="submit" className={s.link}>
              Çıkış yap
            </button>
          </form>
        </PinSetup>
      </Scene>
    </>
  );
}
