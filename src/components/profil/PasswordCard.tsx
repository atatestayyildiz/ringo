"use client";

import { useState, useTransition } from "react";
import { changePasswordAction } from "@/app/(app)/profil/actions";
import { Button, Card, Input, useToast } from "@/components/ui";
import s from "./profil.module.css";

const MIN = 8;

export function PasswordCard() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [touched, setTouched] = useState(false);

  const curErr = touched && current.length === 0 ? "Mevcut şifreyi girin." : undefined;
  const pwErr = touched && pw.length < MIN ? `Şifre en az ${MIN} karakter olmalı.` : undefined;
  const againErr = touched && again !== pw ? "Şifreler aynı değil." : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (current.length === 0 || pw.length < MIN || again !== pw) return;
    start(async () => {
      const res = await changePasswordAction(current, pw, again);
      if (res.ok) {
        toast("Şifre değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.");
        setCurrent("");
        setPw("");
        setAgain("");
        setTouched(false);
      } else {
        toast(res.error, "error");
      }
    });
  };

  return (
    <Card>
      <h2>Şifre değiştir</h2>
      <form className={s.formStack} onSubmit={submit} noValidate>
        <Input
          label="Mevcut şifre"
          type="password"
          autoComplete="current-password"
          error={curErr}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="Yeni şifre"
          type="password"
          autoComplete="new-password"
          hint={`En az ${MIN} karakter.`}
          error={pwErr}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <Input
          label="Yeni şifre (tekrar)"
          type="password"
          autoComplete="new-password"
          error={againErr}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
        <div>
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? "Kaydediliyor" : "Şifreyi değiştir"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
