"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markActivity } from "@/components/lock/activity";
import { PinPad } from "@/components/lock/PinPad";
import s from "@/components/lock/lock.module.css";
import { setPinAction } from "./actions";

/** İlk PIN belirleme: iki kez gir, eşleşmeli; zayıf PIN uyarısı DB'den. */
export function PinSetup() {
  const router = useRouter();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onComplete = (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return;
    }
    const a = first;
    start(async () => {
      const res = await setPinAction(a, pin);
      if (res.ok) {
        markActivity();
        router.replace("/bugun");
        return;
      }
      setFirst(null);
      setError(res.error);
    });
  };

  return (
    <div className={s.screen}>
      <div>
        <h1>{first === null ? "PIN belirle" : "PIN'i tekrar gir"}</h1>
        <p>
          {first === null
            ? "Paneli kilitlediğinde açmak için 6 haneli bir PIN seç. Tekrarlanan ya da sıralı rakamlar kabul edilmez."
            : "Aynı 6 haneyi bir kez daha gir."}
        </p>
      </div>
      <PinPad
        length={6}
        onComplete={onComplete}
        error={error}
        disabled={pending}
        label={first === null ? "Yeni PIN" : "PIN tekrarı"}
      />
      {first !== null ? (
        <button
          type="button"
          className={s.link}
          onClick={() => {
            setFirst(null);
            setError(null);
          }}
        >
          Baştan başla
        </button>
      ) : null}
    </div>
  );
}
