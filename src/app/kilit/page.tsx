import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Scene } from "@/components/scene/Scene";
import { ToastProvider } from "@/components/ui";
import { memberAccent } from "@/lib/accent";
import { DEFAULT_LOGO, isAllowedLogoUrl } from "@/lib/brand-logo";
import { getSessionContext } from "@/lib/session";
import { LockScreen } from "./LockScreen";

export const metadata = { title: "Panel kilitli" };
export const dynamic = "force-dynamic";

/**
 * Kilit ekranı. Proxy yalnız kilitli oturumu buraya bırakır; panel verisi DB'de kilitli.
 * Kullanıcı bilinir: sahne çizgileri kişisel vurgu renginden (panel düzeniyle aynı kural).
 */
export default async function LockPage() {
  const ctx = await getSessionContext();
  const { member, settings } = ctx;
  const first = member.full_name.trim().split(/\s+/)[0] ?? "";
  const accent = await memberAccent(ctx);
  const logo = settings.logo_url && isAllowedLogoUrl(settings.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? settings.logo_url : DEFAULT_LOGO;
  return (
    <ToastProvider>
      {accent ? <style>{`:root{--brand:${accent}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }}>
        <ThemeToggle />
      </div>
      <Scene mode="lock" brandName={settings.brand_name} logoUrl={logo} footer={<MadeBy />}>
        <LockScreen name={first} />
      </Scene>
    </ToastProvider>
  );
}
