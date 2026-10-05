"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { onLockMessage, parseLockStatus } from "@/components/lock/activity";
import { PinField } from "@/components/lock/PinField";
import { useLock } from "@/components/lock/useLock";
import s from "@/components/lock/lock.module.css";
import { useScene } from "@/components/scene/Scene";
import { useDoorExit } from "@/components/scene/useDoorExit";
import { createClient } from "@/lib/supabase/client";
import { forgotPinAction, unlockAction } from "./actions";

/**
 * Kilit ekranı (sahnenin alt bölmesi): "PIN gir" → 6 daire çizilir, yerel klavye açılır. Hanede halka nabzı,
 * yanlışta halka kırmızı + daireler sallanır ve kalan hak yazılır, doğru PIN'de klavye kapanır ve kapı
 * açılışıyla panele; 5 yanlışta oturum kapanır, girişe dönülür.
 */
export function LockScreen({ name }: { name: string }) {
  const router = useRouter();
  const { announceUnlocked } = useLock();
  const { handle } = useScene();
  const { exit, door } = useDoorExit();
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
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
      setResetKey((k) => k + 1);
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
      <div className="sr-only">
        <h1>Panel kilitli</h1>
        <p>{name ? `${name}, devam etmek için PIN'ini gir.` : "Devam etmek için PIN'ini gir."}</p>
      </div>
      <PinField
        length={6}
        label="PIN"
        trigger="PIN gir"
        onComplete={submit}
        error={error}
        resetKey={resetKey}
        busy={pending || leaving}
        onDigit={() => handle.pulse()}
      />
      <form action={forgotPinAction} className={s.below}>
        <button type="submit" className={s.link} disabled={leaving}>
          PIN&apos;imi unuttum
        </button>
      </form>
      {door}
    </>
  );
}
