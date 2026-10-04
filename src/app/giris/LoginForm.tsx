"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { signInAction, type LoginState } from "./actions";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, { error: null });
  const message = state.error ?? notice ?? null;
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
      {message ? (
        <div className="form-error" role="alert">
          {message}
        </div>
      ) : null}
      <Input label="E-posta" name="email" type="email" autoComplete="username" inputMode="email" required />
      <Input label="Şifre" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" variant="ink" block disabled={pending}>
        {pending ? "Giriş yapılıyor" : "Giriş yap"}
      </Button>
      <Link href="/sifre-sifirla" style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)" }}>
        Şifremi unuttum
      </Link>
    </form>
  );
}
