"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AUTO_LOCK_EVENT,
  isTouchDevice,
  onLockMessage,
  parseLockStatus,
  readActivity,
  writeActivity,
} from "./activity";
import { useLock } from "./useLock";

const CHECK_MS = 5_000;
const WRITE_THROTTLE_MS = 2_000;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Otomatik kilit (panel layout'unda). Pointer/dokunma/klavye/kaydırma etkinliği tüm sekmelerde ortak
 * son etkinlik zamanına yazılır; auto_lock_minutes dolunca lockNow(). Başka sekme kilitlerse
 * (BroadcastChannel) ya da sekme görünür olduğunda sunucu kilitli derse kilit ekranına geçer.
 * sessionKey: son şifreli giriş zamanı; yeni girişte eski etkinlik zamanı sayılmaz.
 */
export function AutoLock({ sessionKey }: { sessionKey: string }) {
  const { lockNow } = useLock();
  const minutesRef = useRef(0);
  const lockRef = useRef(lockNow);
  useEffect(() => {
    lockRef.current = lockNow;
  }, [lockNow]);

  useEffect(() => {
    let alive = true;
    let lastWrite = 0;
    let locking = false;

    const rec = readActivity();
    if (!rec || rec.sid !== sessionKey) writeActivity({ sid: sessionKey, t: Date.now() });

    const lock = (alreadyLocked: boolean) => {
      if (locking) return;
      locking = true;
      void lockRef.current({ alreadyLocked }).then((ok) => {
        if (!ok) locking = false;
      });
    };

    const check = () => {
      const m = minutesRef.current;
      if (!alive || m <= 0) return;
      const a = readActivity();
      const t = a && a.sid === sessionKey ? a.t : Date.now();
      if (Date.now() - t >= m * 60_000) lock(false);
    };

    const touch = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_THROTTLE_MS) return;
      lastWrite = now;
      // Süre dolduysa etkinlik kilidi ertelemez (önce kontrol).
      check();
      if (!locking) writeActivity({ sid: sessionKey, t: now });
    };

    const status = async () => {
      try {
        const { data } = await createClient().rpc("lock_status");
        const st = parseLockStatus(data);
        if (!alive || !st) return;
        minutesRef.current = isTouchDevice() ? st.auto_lock_minutes_mobile : st.auto_lock_minutes;
        if (st.locked) lock(true);
        else check();
      } catch {
        // ağ hatası: bir sonraki görünürlükte tekrar
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") void status();
    };
    const onMinutes = (e: Event) => {
      const d = (e as CustomEvent<{ minutes: number; mobile: boolean }>).detail;
      if (d && typeof d.minutes === "number" && d.mobile === isTouchDevice()) minutesRef.current = d.minutes;
    };

    void status();
    const timer = window.setInterval(check, CHECK_MS);
    EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(AUTO_LOCK_EVENT, onMinutes);
    const off = onLockMessage((m) => {
      if (m.type === "locked") lock(true);
      else if (m.type === "minutes" && m.mobile === isTouchDevice()) minutesRef.current = m.minutes;
    });

    return () => {
      alive = false;
      window.clearInterval(timer);
      EVENTS.forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(AUTO_LOCK_EVENT, onMinutes);
      off();
    };
  }, [sessionKey]);

  return null;
}
