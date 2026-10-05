import { Card, ToastProvider } from "@/components/ui";
import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { getSessionContext } from "@/lib/session";
import { LockScreen } from "./LockScreen";

export const metadata = { title: "Panel kilitli" };
export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Kilit ekranı. Proxy yalnız kilitli oturumu buraya bırakır; panel verisi DB'de kilitli. */
export default async function LockPage() {
  const { member, settings } = await getSessionContext();
  const first = member.full_name.trim().split(/\s+/)[0] ?? "";
  return (
    <ToastProvider>
      <div className="login-wrap">
        {HEX.test(settings.brand_color) ? <style>{`:root{--brand:${settings.brand_color}}`}</style> : null}
        <div style={{ position: "fixed", top: 16, right: 16 }}>
          <ThemeToggle />
        </div>
        <Card className="login-card">
          <LockScreen name={first} />
        </Card>
        <MadeBy />
      </div>
    </ToastProvider>
  );
}
