import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

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
      logo: b.logo_url && b.logo_url.startsWith("https://") ? b.logo_url : null,
    };
  } catch {
    return null;
  }
}

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ hata?: string }> }) {
  const { hata } = await searchParams;
  const notice =
    hata === "uye"
      ? "Hesabın bir mağazaya bağlı değil ya da pasif. Yöneticinle görüş."
      : undefined;
  const brand = await loadBranding();
  return (
    <div className="login-wrap">
      {brand?.color ? <style>{`:root{--brand:${brand.color}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <Card className="login-card">
        {brand ? (
          <div className="logo" data-testid="login-brand">
            <span className="logo-mark" aria-hidden="true">
              {brand.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" />
              ) : (
                (brand.name[0] ?? "M").toLocaleUpperCase("tr")
              )}
            </span>
            <span className="logo-name">{brand.name}</span>
          </div>
        ) : null}
        <div>
          <h1>Hoş geldin</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>Devam etmek için giriş yap.</p>
        </div>
        <LoginForm notice={notice} />
      </Card>
    </div>
  );
}
