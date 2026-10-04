"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { requestResetAction, type ResetRequestState } from "./actions";

export function RequestForm() {
  const [state, action, pending] = useActionState<ResetRequestState, FormData>(requestResetAction, { error: null, message: null });
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
      {state.error ? (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.message ? (
        <div data-testid="reset-sent" role="status" style={{ padding: "12px 14px", borderRadius: 16, fontSize: 14, fontWeight: 550, background: "var(--surface-2)" }}>
          {state.message}
        </div>
      ) : null}
      <Input label="E-posta" name="email" type="email" autoComplete="username" inputMode="email" required />
      <Button type="submit" variant="ink" block disabled={pending}>
        {pending ? "Gönderiliyor" : "Bağlantı gönder"}
      </Button>
      <Link href="/giris" style={{ textAlign: "center", fontSize: 14, color: "var(--ink-2)" }}>
        Girişe dön
      </Link>
    </form>
  );
}
