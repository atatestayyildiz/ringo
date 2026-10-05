"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { lockAction } from "@/app/kilit/actions";
import { useDoorOptional } from "@/components/scene/DoorProvider";
import { markActivity, postLockMessage, TAB_ID } from "./activity";

/** Aynı sekmede üst üste kilit geçişini önler (düğme + zamanlayıcı + kanal aynı anda). */
let transitioning = false;

/**
 * Kilit geçişlerinin TEK istemci noktası.
 * - lockNow: kapı panelin üstünde kapanır (DoorProvider; sunucu kilidiyle eşzamanlı), sunucuda
 *   kilitlenir (lock_me), diğer sekmelere duyurulur, /kilit'e geçilir (panel DOM'dan kalkar; /kilit
 *   sahnesi kapının bıraktığı amblem konumundan devralır). `alreadyLocked`: kilit başka sekmede ya da
 *   sunucuda zaten kondu; yalnız ekran geçişi. Kilitleme başarısızsa kapı yeniden açılır.
 * - announceUnlocked: etkinliği tazele, diğer sekmelere duyur (kapı açılışı çağıranda: useDoorExit).
 * - unlockedNow: announceUnlocked + doğrudan panele geçiş (animasyonsuz yedek).
 */
export function useLock() {
  const router = useRouter();
  const door = useDoorOptional();

  const lockNow = useCallback(
    async (opts: { alreadyLocked?: boolean } = {}): Promise<boolean> => {
      if (transitioning) return false;
      transitioning = true;
      try {
        const closing = door ? door.close() : null;
        if (!opts.alreadyLocked) {
          const res = await lockAction();
          if (!res.ok) {
            if (closing && door) {
              await closing;
              await door.reopen();
            }
            return false;
          }
          postLockMessage({ type: "locked", from: TAB_ID });
        }
        router.prefetch("/kilit");
        await closing;
        router.replace("/kilit");
        return true;
      } finally {
        // Geçiş sonrası layout değişir; yine de takılı kalmasın.
        setTimeout(() => {
          transitioning = false;
        }, 3000);
      }
    },
    [router, door],
  );

  const announceUnlocked = useCallback((opts: { remote?: boolean } = {}) => {
    markActivity();
    if (!opts.remote) postLockMessage({ type: "unlocked", from: TAB_ID });
  }, []);

  const unlockedNow = useCallback(
    (opts: { remote?: boolean } = {}) => {
      announceUnlocked(opts);
      router.replace("/bugun");
    },
    [router, announceUnlocked],
  );

  return { lockNow, announceUnlocked, unlockedNow };
}
