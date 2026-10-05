"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import sc from "@/components/scene/scene.module.css";
import { useDismiss } from "@/components/scene/useDismiss";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { signInAction, type LoginState } from "./actions";
import s from "./login.module.css";

/**
 * Giriş (sahnenin alt bölmesi): "Giriş yap" metin düğmesi; basınca küçük giriş kartı parlayarak belirir ve
 * e-posta alanına odaklanır (mobilde e-posta klavyesi). Enter ya da Giriş yap: yanlışsa kart kalır, hata
 * yazılır; doğruysa klavye kapanır, kart söner, ardından kapı koreografisi başlar. Dışarı dokunmak ya da
 * Escape kartı söndürüp kapatır, "Giriş yap" geri gelir.
 */
export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const { exit, door } = useDoorExit();
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, { error: null });
  const [open, setOpen] = useState(Boolean(notice));
  const [closing, setClosing] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<LoginState | null>(null);
  // Gönderim kilidi: istek sürerken ya da kapı oynarken ikinci gönderim yok.
  const busy = useRef(false);
  const leaving = Boolean(state.to);
  const message = state.error ?? (leaving ? null : notice) ?? null;

  // Başarı: panel için klavye kapanır, kart söner, logo parlar, kapı kapanıp ışınlar çizilir, panelde açılır.
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

  const reveal = () => {
    // Aynı jestte odak: mobil klavye açılsın.
    flushSync(() => setOpen(true));
    emailRef.current?.focus({ preventScroll: true });
  };

  // Dışarı dokunma / Escape: klavye kapanır, kart söner, metin düğmesi geri gelir.
  const dismiss = () => {
    if (closing) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 240);
  };
  useDismiss(open && !closing, formRef, dismiss, pending || leaving);

  if (!open) {
    return (
      <>
        <button type="button" className={`${sc.trigger} ${sc.revealIn}`} onClick={reveal}>
          Giriş yap
        </button>
        {door}
      </>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (busy.current) e.preventDefault();
        else busy.current = true;
      }}
      ref={formRef}
      className={`${sc.glass} ${s.card}`}
      data-closing={closing ? "" : undefined}
      noValidate
      aria-busy={pending || leaving}
      aria-label="Giriş"
      data-dock-open=""
    >
      {message ? (
        <div className={`form-error ${s.error}`} role="alert">
          {message}
        </div>
      ) : null}
      <label className={s.field}>
        <span className={s.label}>E-posta</span>
        <input
          ref={emailRef}
          className={s.input}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          required
        />
      </label>
      <label className={s.field}>
        <span className={s.label}>Şifre</span>
        <input className={s.input} name="password" type="password" autoComplete="current-password" enterKeyHint="go" required />
      </label>
      <button type="submit" className={s.submit} disabled={pending || leaving}>
        {pending ? "Giriş yapılıyor" : leaving ? "Açılıyor" : "Giriş yap"}
      </button>
      <Link href="/sifre-sifirla" className={s.forgot}>
        Şifremi unuttum
      </Link>
      {door}
    </form>
  );
}
