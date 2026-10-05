"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { onLockMessage, parseLockStatus } from "@/components/lock/activity";
import { PinPad } from "@/components/lock/PinPad";
import { useLock } from "@/components/lock/useLock";
import s from "@/components/lock/lock.module.css";
import { createClient } from "@/lib/supabase/client";
import { forgotPinAction, unlockAction } from "./actions";

/** Kilit ekranı işlevi: PIN ile aç, kalan hak, 5 yanlışta girişe dönüş, "PIN'imi unuttum". */
export function LockScreen({ name }: { name: string }) {
  const router = useRouter();
  const { unlockedNow } = useLock();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (pin: string) => {
    start(async () => {
      const res = await unlockAction(pin);
      if (res.ok) {
        setError(null);
        unlockedNow();
        return;
      }
      setError(res.error);
      if (res.signedOut) router.replace("/giris?hata=pin");
    });
  };

  // Başka sekmede açıldıysa (kanal ya da sekme görünür olunca sunucu durumu) panele dön.
  const recheck = useCallback(async () => {
    try {
      const { data } = await createClient().rpc("lock_status");
      const st = parseLockStatus(data);
      if (st && !st.locked) unlockedNow({ remote: true });
    } catch {
      // ağ hatası: kilit ekranında kal
    }
  }, [unlockedNow]);

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
    <div className={s.screen}>
      <div>
        <h1>Panel kilitli</h1>
        <p>{name ? `${name}, devam etmek için PIN'ini gir.` : "Devam etmek için PIN'ini gir."}</p>
      </div>
      <PinPad length={6} onComplete={submit} error={error} disabled={pending} />
      <form action={forgotPinAction}>
        <button type="submit" className={s.link}>
          PIN&apos;imi unuttum
        </button>
      </form>
    </div>
  );
}
