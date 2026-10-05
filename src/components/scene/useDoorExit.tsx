"use client";

/**
 * Sahneden panele kapı açılışıyla çıkış (giriş, kilit açma, PIN belirleme ortak).
 *   const { exit, door } = useDoorExit();   // <Scene> içinde
 *   return <>{...}{door}</>;
 *   await exit("/bugun");
 * Sıra: klavye kapanır + bölme söner → logo çerçevesi parlar (Scene.depart) → kapı sahneyi örter, ışınlar
 * köşelere ilerler → panele gidilir; (app) DoorProvider kapıyı aynı konumdan pistonla açar.
 * Kapı katmanı yalnız çıkış sırasında DOM'dadır.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Door, type DoorHandle } from "./Door";
import { armDoor } from "./doorFlag";
import { prefersReducedMotion } from "./motion";
import { useScene } from "./Scene";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Sahnenin çözülmüş vurgu rengi (panel kapısı aynı renkle açılsın). */
function resolvedColor(): string | null {
  const el = document.querySelector<HTMLElement>("[data-scene-emblem]") ?? document.documentElement;
  const v = getComputedStyle(el).getPropertyValue("--c").trim() || getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return HEX.test(v) ? v : null;
}

export function useDoorExit() {
  const router = useRouter();
  const { handle, face } = useScene();
  const ref = useRef<DoorHandle>(null);
  const [mounted, setMounted] = useState(false);
  const waiters = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!mounted) return;
    const list = waiters.current;
    waiters.current = [];
    list.forEach((f) => f());
  }, [mounted]);

  const exit = useCallback(
    async (to: string) => {
      router.prefetch(to);
      const geom = await handle.depart();
      if (!ref.current) {
        await new Promise<void>((r) => {
          waiters.current.push(r);
          setMounted(true);
        });
      }
      ref.current?.cover(geom);
      await ref.current?.drawLines();
      armDoor(geom, { ...face, color: face.color && HEX.test(face.color) ? face.color : resolvedColor() }, prefersReducedMotion() ? "closed" : "lines");
      router.replace(to);
    },
    [router, handle, face],
  );

  return { exit, door: mounted ? <Door ref={ref} face={face} /> : null };
}
