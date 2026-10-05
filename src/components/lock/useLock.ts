"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { lockAction } from "@/app/kilit/actions";
import { markActivity, postLockMessage, TAB_ID } from "./activity";

/** Aynı sekmede üst üste kilit geçişini önler (düğme + zamanlayıcı + kanal aynı anda). */
let transitioning = false;

/**
 * Kilit geçişlerinin TEK istemci noktası. Kapı animasyonu (kardeş şerit) buraya takılır:
 * - lockNow: sunucuda kilitle (lock_me), diğer sekmelere duyur, kilit ekranına geç.
 *   `alreadyLocked`: kilit başka sekmede/sunucuda zaten kondu; yalnız ekran geçişi.
 * - unlockedNow: kilit açıldı; etkinliği tazele, diğer sekmelere duyur, panele geç.
 */
export function useLock() {
  const router = useRouter();

  const lockNow = useCallback(
    async (opts: { alreadyLocked?: boolean } = {}): Promise<boolean> => {
      if (transitioning) return false;
      transitioning = true;
      try {
        if (!opts.alreadyLocked) {
          const res = await lockAction();
          if (!res.ok) return false;
          postLockMessage({ type: "locked", from: TAB_ID });
        }
        // Kapı kapanma animasyonu buraya (kardeş şerit); şimdilik doğrudan geçiş.
        router.replace("/kilit");
        return true;
      } finally {
        // Geçiş sonrası layout değişir; yine de takılı kalmasın.
        setTimeout(() => {
          transitioning = false;
        }, 1500);
      }
    },
    [router],
  );

  const unlockedNow = useCallback(
    (opts: { remote?: boolean } = {}) => {
      markActivity();
      if (!opts.remote) postLockMessage({ type: "unlocked", from: TAB_ID });
      // Kapı açılma animasyonu buraya (kardeş şerit); şimdilik doğrudan geçiş.
      router.replace("/bugun");
    },
    [router],
  );

  return { lockNow, unlockedNow };
}
