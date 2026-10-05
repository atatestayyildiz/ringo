"use client";

/**
 * Panel düzeyinde kapı. (app) düzeninde bir kez sarar; sayfa geçişlerinde sökülmez, kapı oynamaz.
 *
 * - Girişten / kilit açılışından gelindiyse (armDoor bayrağı) kapı ilk karede kapalı çizilir,
 *   ilk boyamadan sonra açılır (<main> hafif yakınlaşır) ve kaldırılır.
 * - Kilit için: const { close } = useDoor(); await close(); router.replace("/kilit");
 *   close(geom?) kapıyı köşelerden kapatır (~1.3 sn). geom verilmezse amblem ekran ortasının üstünde
 *   (x %50, y %32, kenar min(vw,vh) * 0.42) varsayılır; /kilit sahnesinin amblemiyle hizalamak için ver.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Door, type DoorHandle } from "./Door";
import { clearDoorFlag, flagGeom, parseDoorFlag, readDoorFlagRaw } from "./doorFlag";
import type { EmblemSnapshot } from "./Scene";
import type { Face } from "./parts";

type DoorApi = { close(geom?: EmblemSnapshot): Promise<void> };
const Ctx = createContext<DoorApi | null>(null);

export function useDoor(): DoorApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDoor yalnız <DoorProvider> içinde kullanılır.");
  return v;
}

const noop = () => () => {};

export function DoorProvider({
  brandName,
  brandColor = null,
  logoUrl = null,
  children,
}: {
  brandName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  children: ReactNode;
}) {
  const raw = useSyncExternalStore(noop, readDoorFlagRaw, () => null);
  const [done, setDone] = useState<string | null>(null);
  const flag = raw && raw !== done ? parseDoorFlag(raw) : null;

  const openRef = useRef<DoorHandle>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!raw || raw === done || started.current === raw) return;
    started.current = raw;
    if (!parseDoorFlag(raw)) {
      clearDoorFlag();
      queueMicrotask(() => setDone(raw));
      return;
    }
    // İlk boyama tamamlansın, panel kapının arkasında hazır olsun.
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        await openRef.current?.split(document.querySelector("main"));
        clearDoorFlag();
        setDone(raw);
      }),
    );
  }, [raw, done]);

  /* ---- kapanma (kilit) ---- */
  const closeRef = useRef<DoorHandle>(null);
  const [closing, setClosing] = useState(false);
  const waiters = useRef<(() => void)[]>([]);
  const face = useMemo<Face>(() => ({ name: brandName, color: brandColor, logo: logoUrl }), [brandName, brandColor, logoUrl]);

  useEffect(() => {
    if (!closing) return;
    const list = waiters.current;
    waiters.current = [];
    list.forEach((f) => f());
  }, [closing]);

  const close = useCallback(async (geom?: EmblemSnapshot) => {
    if (!closeRef.current) {
      await new Promise<void>((r) => {
        waiters.current.push(r);
        setClosing(true);
      });
    }
    const g = geom ?? { cx: innerWidth / 2, cy: innerHeight * 0.32, size: Math.min(innerWidth, innerHeight) * 0.42 };
    await closeRef.current?.close(g);
  }, []);

  const api = useMemo(() => ({ close }), [close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {flag ? <Door key={raw ?? ""} ref={openRef} face={flag.face} initial={{ geom: flagGeom(flag), stage: flag.stage }} /> : null}
      {closing ? <Door ref={closeRef} face={face} /> : null}
    </Ctx.Provider>
  );
}
