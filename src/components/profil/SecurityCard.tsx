"use client";

import { useState, useTransition } from "react";
import { changePinAction, setAutoLockAction } from "@/app/pin-belirle/actions";
import { notifyAutoLockChanged } from "@/components/lock/activity";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import s from "./profil.module.css";

const OPTIONS = [
  { v: 0, label: "Kapalı" },
  { v: 5, label: "5 dakika" },
  { v: 10, label: "10 dakika" },
  { v: 15, label: "15 dakika" },
  { v: 30, label: "30 dakika" },
];

const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Profil > Güvenlik: panel PIN'i değiştirme ve otomatik kilit süresi. */
export function SecurityCard({ autoLockMinutes, autoLockMinutesMobile }: { autoLockMinutes: number; autoLockMinutesMobile: number }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [minutes, setMinutes] = useState(autoLockMinutes);
  const [minutesMobile, setMinutesMobile] = useState(autoLockMinutesMobile);
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [touched, setTouched] = useState(false);

  const six = (v: string) => /^\d{6}$/.test(v);
  const curErr = touched && !six(current) ? "Mevcut PIN'i 6 hane olarak gir." : undefined;
  const pinErr = touched && !six(pin) ? "Yeni PIN 6 haneli olmalı." : undefined;
  const againErr = touched && again !== pin ? "PIN'ler aynı değil." : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!six(current) || !six(pin) || again !== pin) return;
    start(async () => {
      const res = await changePinAction(current, pin, again);
      if (res.ok) {
        toast("PIN değiştirildi.");
        setCurrent("");
        setPin("");
        setAgain("");
        setTouched(false);
      } else {
        toast(res.error, "error");
      }
    });
  };

  const changeMinutes = (v: number, mobile = false) => {
    const prev = mobile ? minutesMobile : minutes;
    const set = mobile ? setMinutesMobile : setMinutes;
    const where = mobile ? "Telefonda" : "Bilgisayarda";
    set(v);
    start(async () => {
      const res = await setAutoLockAction(v, mobile);
      if (res.ok) {
        notifyAutoLockChanged(v, mobile);
        toast(v === 0 ? `${where} otomatik kilit kapatıldı.` : `${where} panel ${v} dakika hareketsizlikte kilitlenir.`);
      } else {
        set(prev);
        toast(res.error, "error");
      }
    });
  };

  return (
    <Card>
      <h2>Güvenlik</h2>
      <p className={s.sub}>Panel kilidi PIN&apos;i ve hareketsizlikte otomatik kilit.</p>
      <div className={s.formStack}>
        <Select
          label="Otomatik kilit, bilgisayar"
          value={String(minutes)}
          disabled={pending}
          onChange={(e) => changeMinutes(Number(e.target.value))}
        >
          {OPTIONS.map((o) => (
            <option key={o.v} value={String(o.v)}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Otomatik kilit, telefon"
          value={String(minutesMobile)}
          disabled={pending}
          onChange={(e) => changeMinutes(Number(e.target.value), true)}
        >
          {OPTIONS.map((o) => (
            <option key={o.v} value={String(o.v)}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <form className={s.formStack} onSubmit={submit} noValidate style={{ marginTop: 16 }}>
        <Input
          label="Mevcut PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          error={curErr}
          value={current}
          onChange={(e) => setCurrent(digitsOnly(e.target.value))}
        />
        <Input
          label="Yeni PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          hint="6 hane; tekrarlanan ya da sıralı rakamlar olmaz."
          error={pinErr}
          value={pin}
          onChange={(e) => setPin(digitsOnly(e.target.value))}
        />
        <Input
          label="Yeni PIN (tekrar)"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          error={againErr}
          value={again}
          onChange={(e) => setAgain(digitsOnly(e.target.value))}
        />
        <div>
          <Button type="submit" variant="brand" disabled={pending}>
            {pending ? "Kaydediliyor" : "PIN'i değiştir"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
