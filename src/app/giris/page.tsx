import { ToastProvider } from "@/components/ui";
import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Scene } from "@/components/scene/Scene";
import { DEFAULT_LOGO, PRODUCT_NAME, isAllowedLogoUrl } from "@/lib/brand-logo";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";
import { ResetFlash } from "./ResetFlash";

const HEX = /^#[0-9a-fA-F]{6}$/;

type Branding = { name: string; color: string | null; logo: string | null };

/** Anon login_branding(); hata ya da boş sonuçta nötr varsayılan (marka gösterilmez). */
async function loadBranding(): Promise<Branding | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("login_branding");
    const b = data?.[0];
    if (error || !b || !b.brand_name?.trim()) return null;
    return {
      name: b.brand_name.trim(),
      color: HEX.test(b.brand_color ?? "") ? b.brand_color : null,
      logo: b.logo_url && isAllowedLogoUrl(b.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL) ? b.logo_url : null,
    };
  } catch {
    return null;
  }
}

export const metadata = { title: "Giriş" };

/** Giriş sahnesi: kimlik yok, renk mağaza renginden (login_branding). */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ hata?: string; sifre?: string }> }) {
  const { hata, sifre } = await searchParams;
  const notice =
    hata === "uye"
      ? "Hesabın bir mağazaya bağlı değil ya da pasif. Yöneticinle görüş."
      : hata === "pin"
        ? "Çok fazla yanlış PIN denemesi. PIN'ini yöneticin sıfırlayabilir."
        : hata === "pinunuttum"
          ? "PIN'ini unuttuysan yöneticinden Ayarlar > Ekip içinden sıfırlamasını iste."
          : undefined;
  const brand = await loadBranding();
  return (
    <ToastProvider>
      {brand?.color ? <style>{`:root{--brand:${brand.color}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }}>
        <ThemeToggle />
      </div>
      <Scene
        brandName={brand?.name ?? PRODUCT_NAME}
        brandColor={brand?.color ?? null}
        logoUrl={brand?.logo ?? DEFAULT_LOGO}
        brandTestId={brand ? "login-brand" : undefined}
        footer={<MadeBy />}
      >
        <h1 className="sr-only">Giriş</h1>
        <LoginForm notice={notice} />
      </Scene>
      <ResetFlash show={sifre === "yenilendi"} />
    </ToastProvider>
  );
}
