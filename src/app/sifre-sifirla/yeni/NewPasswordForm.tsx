"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import { newPasswordAction, type NewPasswordState } from "./actions";

export function NewPasswordForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const [state, action, pending] = useActionState<NewPasswordState, FormData>(newPasswordAction, { error: null, linkDead: false });
  // Kod gizli inputta kalır; adres çubuğundan ve tarayıcı geçmişinden kaldırılır (D3).
  useEffect(() => {
    window.history.replaceState(null, "", "/sifre-sifirla/yeni");
  }, []);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
      {state.error ? (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      ) : null}
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.linkDead ? (
        <Link href="/sifre-sifirla" className="btn btn-ink btn-block" style={{ textAlign: "center" }}>
          Yeni bağlantı iste
        </Link>
      ) : (
        <>
          <Input label="Yeni şifre" name="password" type="password" autoComplete="new-password" minLength={8} hint="En az 8 karakter." required />
          <Input label="Yeni şifre (tekrar)" name="repeat" type="password" autoComplete="new-password" required />
          <Button type="submit" variant="ink" block disabled={pending}>
            {pending ? "Kaydediliyor" : "Şifreyi değiştir"}
          </Button>
        </>
      )}
    </form>
  );
}
