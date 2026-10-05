"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { Door, type DoorHandle } from "@/components/scene/Door";
import { armDoor } from "@/components/scene/doorFlag";
import { prefersReducedMotion } from "@/components/scene/motion";
import { useScene } from "@/components/scene/Scene";
import { Button, Input } from "@/components/ui";
import { signInAction, type LoginState } from "./actions";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Giriş sayfasında kökte tanımlı marka rengi (kapı panelde aynı renkle açılsın). */
function rootBrand(): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return HEX.test(v) ? v : null;
}

export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const { handle, face } = useScene();
  const door = useRef<DoorHandle>(null);
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
    router.prefetch(to);
    if (to !== "/bugun") {
      router.replace(to);
      return;
    }
    void (async () => {
      const geom = await handle.depart();
      door.current?.cover(geom);
      await door.current?.drawLines();
      armDoor(geom, { ...face, color: face.color ?? rootBrand() }, prefersReducedMotion() ? "closed" : "lines");
      router.replace(to);
    })();
  }, [state, router, handle, face]);

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
      <Door ref={door} face={face} />
    </form>
  );
}
