"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { onLockMessage, parseLockStatus } from "@/components/lock/activity";
import { PinPad } from "@/components/lock/PinPad";
import { useLock } from "@/components/lock/useLock";
import s from "@/components/lock/lock.module.css";
import { sceneGlass, useScene } from "@/components/scene/Scene";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { forgotPinAction, unlockAction } from "./actions";

/**
 * Kilit ekranı (sahne içinde): tuşta halka nabzı, yanlışta halka kırmızı + noktalar sallanır ve kalan hak
 * yazılır, doğru PIN'de kapı açılışıyla panele; 5 yanlışta oturum kapanır, girişe dönülür.
 */
export function LockScreen({ name }: { name: string }) {
  const router = useRouter();
  const { announceUnlocked } = useLock();
  const { handle } = useScene();
  const { exit, door } = useDoorExit();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const [pending, start] = useTransition();

  const open = useCallback(
    (remote: boolean) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      setLeaving(true);
      announceUnlocked({ remote });
      void exit("/bugun");
    },
    [announceUnlocked, exit],
  );

  const submit = (pin: string) => {
    if (leavingRef.current) return;
    start(async () => {
      const res = await unlockAction(pin);
      if (res.ok) {
        setError(null);
        open(false);
        return;
      }
      setError(res.error);
      handle.error();
      if (res.signedOut) router.replace("/giris?hata=pin");
    });
  };

  // Başka sekmede açıldıysa (kanal ya da sekme görünür olunca sunucu durumu) panele dön.
  const recheck = useCallback(async () => {
    try {
      const { data } = await createClient().rpc("lock_status");
      const st = parseLockStatus(data);
      if (st && !st.locked) open(true);
    } catch {
      // ağ hatası: kilit ekranında kal
    }
  }, [open]);

  useEffect(() => {
    const off = onLockMessage((m) => {
      if (m.type === "unlocked") void recheck();
    });
    const onVis = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [recheck]);

  return (
    <>
      <Card className={`${sceneGlass} ${s.card}`}>
        <div>
          <h1>Panel kilitli</h1>
          <p>{name ? `${name}, devam etmek için PIN'ini gir.` : "Devam etmek için PIN'ini gir."}</p>
        </div>
        <PinPad length={6} onComplete={submit} error={error} disabled={pending || leaving} onKey={() => handle.pulse()} />
      </Card>
      <form action={forgotPinAction} className={s.below}>
        <button type="submit" className={s.link} disabled={leaving}>
          PIN&apos;imi unuttum
        </button>
      </form>
      {door}
    </>
  );
}
