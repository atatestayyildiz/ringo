import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ hata?: string }> }) {
  const { hata } = await searchParams;
  const notice =
    hata === "uye"
      ? "Hesabın bir mağazaya bağlı değil ya da pasif. Yöneticinle görüş."
      : undefined;
  return (
    <div className="login-wrap">
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <Card className="login-card">
        <div>
          <h1>Hoş geldin</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>Devam etmek için giriş yap.</p>
        </div>
        <LoginForm notice={notice} />
      </Card>
    </div>
  );
}
