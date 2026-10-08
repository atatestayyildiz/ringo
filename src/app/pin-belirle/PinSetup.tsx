"use client";

import { useRef, useState, useTransition } from "react";
import { markActivity } from "@/components/lock/activity";
import { PinField } from "@/components/lock/PinField";
import s from "@/components/lock/lock.module.css";
import { useScene } from "@/components/scene/Scene";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { setPinAction } from "./actions";

/**
 * İlk PIN belirleme (sahnenin alt bölmesi, kilitle aynı dil): "PIN belirle" → daireler; iki adım, eşleşmeli.
 * PIN 4 ile 8 hane arasında: ilk adımda daireler hane girildikçe artar, Enter ya da "Devam" ile ilerlenir;
 * ikinci adımda aynı hane sayısı tamamlanınca otomatik gönderilir. Zayıf PIN uyarısı DB'den; başarıda klavye kapanır, kapı açılışıyla panele.
 */
export function PinSetup({ children }: { children?: React.ReactNode }) {
  const { handle } = useScene();
  const { exit, door } = useDoorExit();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [pending, start] = useTransition();

  const restart = (msg: string | null) => {
    setFirst(null);
    setError(msg);
    setResetKey((k) => k + 1);
  };

  const onComplete = (pin: string) => {
    if (leavingRef.current) return;
    if (first === null) {
      setFirst(pin);
      setError(null);
      setResetKey((k) => k + 1);
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
      restart(res.error);
      handle.error();
    });
  };

  const step2 = first !== null;
  return (
    <>
      <div className="sr-only">
        <h1>{step2 ? "PIN'i tekrar gir" : "PIN belirle"}</h1>
        <p>{step2 ? `Aynı ${first.length} haneyi bir kez daha gir.` : "Paneli açmak için 4 ile 8 hane arasında bir PIN seç; bitince Enter ya da Devam. Tekrarlanan ya da sıralı rakamlar olmaz."}</p>
      </div>
      <PinField
        length={step2 ? first.length : 8}
        flexible={step2 ? undefined : { min: 4 }}
        label={step2 ? "PIN tekrarı" : "Yeni PIN"}
        trigger="PIN belirle"
        onComplete={onComplete}
        error={error}
        resetKey={resetKey}
        redrawKey={step2 ? 2 : 1}
        busy={pending || leaving}
        onDigit={() => handle.pulse()}
      />
      <div className={s.below}>
        {step2 && !leaving ? (
          <button type="button" className={s.link} onClick={() => restart(null)}>
            Baştan başla
          </button>
        ) : null}
        {leaving ? null : children}
      </div>
      {door}
    </>
  );
}
