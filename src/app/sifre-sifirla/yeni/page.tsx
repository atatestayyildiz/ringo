import Link from "next/link";
import { Card } from "@/components/ui";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { NewPasswordForm } from "./NewPasswordForm";

export const metadata = { title: "Yeni şifre" };

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams;
  const hasToken = typeof token_hash === "string" && token_hash.length > 0 && type === "recovery";
  return (
    <div className="login-wrap">
      <div style={{ position: "fixed", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <Card className="login-card">
        <div>
          <h1>Yeni şifre belirle</h1>
          <p style={{ color: "var(--ink-2)", marginTop: 6 }}>Hesabın için yeni bir şifre seç.</p>
        </div>
        {hasToken ? (
          <NewPasswordForm tokenHash={token_hash} type={type} />
        ) : (
          <>
            <div className="form-error" role="alert">
              Bağlantı geçersiz ya da eksik. Yeni bir bağlantı isteyin.
            </div>
            <Link href="/sifre-sifirla" className="btn btn-ink btn-block" style={{ textAlign: "center" }}>
              Yeni bağlantı iste
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}
