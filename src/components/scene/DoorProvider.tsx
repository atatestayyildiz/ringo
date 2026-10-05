"use client";

/**
 * Panel düzeyinde kapı. (app) düzeninde bir kez sarar; sayfa geçişlerinde sökülmez, kapı oynamaz.
 *
 * - Girişten / kilit açılışından gelindiyse (armDoor bayrağı) kapı ilk karede kapalı çizilir,
 *   ilk boyamadan sonra açılır (<main> hafif yakınlaşır) ve kaldırılır.
 * - Kilit için (useLock.lockNow): await useDoor().close(); router.replace("/kilit");
 *   close(geom?) kapıyı köşelerden kapatır (~2 sn). geom verilmezse ekran merkezi (sahne logosu her zaman
 *   ortada); /kilit sahnesi kapının bıraktığı konumdan devralır.
 * Renk: brandColor verilmezse kapı --brand'i (düzenin etkin vurgusu) kullanır.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Door, type DoorHandle } from "./Door";
import { armArrival, clearArrival, clearDoorFlag, docState, flagGeom, parseDoorFlag, readDoorFlagRaw, sceneEmblemGuess } from "./doorFlag";
import type { EmblemSnapshot } from "./Scene";
import type { Face } from "./parts";

type DoorApi = {
  /** Kapıyı köşelerden kapatır; /kilit varışı için konumu bırakır (armArrival) ve kullanılan konumu döner. */
  close(geom?: EmblemSnapshot): Promise<EmblemSnapshot>;
  /** Kapanmış kapıyı yeniden açar (kilitleme başarısızsa). */
  reopen(): Promise<void>;
};
const Ctx = createContext<DoorApi | null>(null);

/** Sağlayıcı yoksa (ör. /kilit, /pin-belirle) null. */
export function useDoorOptional(): DoorApi | null {
  return useContext(Ctx);
}

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
  // Yalnız istemci gezinmesiyle gelindiyse (girişten / kilitten) kapı oynar; tam yüklemede asla.
  const [eligible] = useState(() => typeof window !== "undefined" && docState.painted);
  const flag = eligible && raw && raw !== done ? parseDoorFlag(raw) : null;

  const openRef = useRef<DoorHandle>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!raw || raw === done || started.current === raw) return;
    started.current = raw;
    if (!eligible || !parseDoorFlag(raw)) {
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
  }, [raw, done, eligible]);

  useEffect(() => {
    docState.painted = true;
  }, []);

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

  const safety = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const reopen = useCallback(async () => {
    if (safety.current) clearTimeout(safety.current);
    safety.current = null;
    clearArrival();
    await closeRef.current?.split();
    setClosing(false);
  }, []);

  const close = useCallback(
    async (geom?: EmblemSnapshot) => {
      if (!closeRef.current) {
        await new Promise<void>((r) => {
          waiters.current.push(r);
          setClosing(true);
        });
      }
      const g = geom ?? sceneEmblemGuess();
      await closeRef.current?.close(g);
      armArrival(g);
      // Gezinme olmazsa (ağ hatası, yönlendirme) panel kapının arkasında kilitli kalmasın.
      if (safety.current) clearTimeout(safety.current);
      safety.current = window.setTimeout(() => void reopen(), 10_000);
      return g;
    },
    [reopen],
  );

  const api = useMemo<DoorApi>(() => ({ close, reopen }), [close, reopen]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {flag ? <Door key={raw ?? ""} ref={openRef} face={flag.face} initial={{ geom: flagGeom(flag), stage: flag.stage }} /> : null}
      {closing ? <Door ref={closeRef} face={face} /> : null}
    </Ctx.Provider>
  );
}
