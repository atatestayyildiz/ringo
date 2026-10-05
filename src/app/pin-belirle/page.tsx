import { signOutAction } from "@/app/(app)/actions";
import { Card } from "@/components/ui";
import { MadeBy } from "@/components/shell/MadeBy";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import s from "@/components/lock/lock.module.css";
import { getSessionContext } from "@/lib/session";
import { PinSetup } from "./PinSetup";

export const metadata = { title: "PIN belirle" };
export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** İlk girişte zorunlu PIN belirleme (proxy PIN'i olmayanı başka yere geçirmez). */
export default async function PinSetupPage() {
  const { settings } = await getSessionContext();
  return (
    <div className="login-wrap">
      {HEX.test(settings.brand_color) ? <style>{`:root{--brand:${settings.brand_color}}`}</style> : null}
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <Card className="login-card">
        <PinSetup />
        <form action={signOutAction} style={{ textAlign: "center" }}>
          <button type="submit" className={s.link}>
            Çıkış yap
          </button>
        </form>
      </Card>
      <MadeBy />
    </div>
  );
}
