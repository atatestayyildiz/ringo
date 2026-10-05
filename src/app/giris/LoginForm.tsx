"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { Button, Input } from "@/components/ui";
import { signInAction, type LoginState } from "./actions";

export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const { exit, door } = useDoorExit();
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, { error: null });
  const handled = useRef<LoginState | null>(null);
  // Gönderim kilidi: istek sürerken ya da kapı oynarken ikinci gönderim yok.
  const busy = useRef(false);
  const leaving = Boolean(state.to);
  const message = state.error ?? (leaving ? null : notice) ?? null;

  // Başarı: panel için sahne söner, kapı kapanıp çizgiler çizilir, panel arkada yüklenip kapı açılır.
  useEffect(() => {
    const to = state.to;
    if (!to) busy.current = false;
    if (!to || handled.current === state) return;
    handled.current = state;
    if (to !== "/bugun") {
      router.replace(to);
      return;
    }
    void exit(to);
  }, [state, router, exit]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (busy.current) e.preventDefault();
        else busy.current = true;
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate aria-busy={pending || leaving}>
      {message ? (
        <div className="form-error" role="alert">
          {message}
        </div>
      ) : null}
      <Input label="E-posta" name="email" type="email" autoComplete="username" inputMode="email" required />
      <Input label="Şifre" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" variant="ink" block disabled={pending || leaving}>
        {pending ? "Giriş yapılıyor" : leaving ? "Açılıyor" : "Giriş yap"}
      </Button>
      <Link href="/sifre-sifirla" style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)" }}>
        Şifremi unuttum
      </Link>
      {door}
    </form>
  );
}
