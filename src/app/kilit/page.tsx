import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Scene } from "@/components/scene/Scene";
import { ToastProvider } from "@/components/ui";
import { isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { LockScreen } from "./LockScreen";

export const metadata = { title: "Panel kilitli" };
export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Kilit ekranı. Proxy yalnız kilitli oturumu buraya bırakır; panel verisi DB'de kilitli. */
export default async function LockPage() {
  const { member, settings } = await getSessionContext();
  const first = member.full_name.trim().split(/\s+/)[0] ?? "";
  const color = HEX.test(settings.brand_color) ? settings.brand_color : null;
  const logo = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : null;
  return (
    <ToastProvider>
      {color ? <style>{`:root{--brand:${color}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }}>
        <ThemeToggle />
      </div>
      <Scene mode="lock" brandName={settings.brand_name} brandColor={color} logoUrl={logo}>
        <LockScreen name={first} />
        <MadeBy />
      </Scene>
    </ToastProvider>
  );
}
