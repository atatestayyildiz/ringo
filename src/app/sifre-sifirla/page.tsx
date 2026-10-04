import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { RequestForm } from "./RequestForm";

export const metadata = { title: "Şifremi unuttum" };

export default function ResetRequestPage() {
  return (
    <div className="login-wrap">
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <Card className="login-card">
        <div>
          <h1>Şifremi unuttum</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>E-posta adresini gir, şifre sıfırlama bağlantısı gönderelim.</p>
        </div>
        <RequestForm />
      </Card>
    </div>
  );
}
