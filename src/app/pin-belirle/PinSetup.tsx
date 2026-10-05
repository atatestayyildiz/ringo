"use client";

import { useRef, useState, useTransition } from "react";
import { markActivity } from "@/components/lock/activity";
import { PinPad } from "@/components/lock/PinPad";
import s from "@/components/lock/lock.module.css";
import { sceneGlass, useScene } from "@/components/scene/Scene";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { Card } from "@/components/ui";
import { setPinAction } from "./actions";

/** İlk PIN belirleme (sahne içinde): iki kez gir, eşleşmeli; zayıf PIN uyarısı DB'den; başarıda kapı açılışı. */
export function PinSetup({ children }: { children?: React.ReactNode }) {
  const { handle } = useScene();
  const { exit, door } = useDoorExit();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [pending, start] = useTransition();

  const onComplete = (pin: string) => {
    if (leavingRef.current) return;
    if (first === null) {
      setFirst(pin);
      setError(null);
      handle.pulse();
      return;
    }
    const a = first;
    start(async () => {
      const res = await setPinAction(a, pin);
      if (res.ok) {
        leavingRef.current = true;
        setLeaving(true);
        markActivity();
        void exit("/bugun");
        return;
      }
      setFirst(null);
      setError(res.error);
      handle.error();
    });
  };

  return (
    <>
      <Card className={`${sceneGlass} ${s.card}`}>
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
          disabled={pending || leaving}
          label={first === null ? "Yeni PIN" : "PIN tekrarı"}
          onKey={() => handle.pulse()}
        />
      </Card>
      <div className={s.below}>
        {first !== null && !leaving ? (
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
        {leaving ? null : children}
      </div>
      {door}
    </>
  );
}
