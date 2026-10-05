"use client";

/**
 * Sahneden panele kapı açılışıyla çıkış (giriş, kilit açma, PIN belirleme ortak).
 *   const { exit, door } = useDoorExit();   // <Scene> içinde
 *   return <>{...}{door}</>;
 *   await exit("/bugun");  // içerik söner (0.3 sn), kapı kapanır + çizgiler (0.5 sn), panele gider;
 *                          // (app) DoorProvider kapıyı aynı konumdan açar (0.8 sn).
 */

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { Door, type DoorHandle } from "./Door";
import { armDoor } from "./doorFlag";
import { prefersReducedMotion } from "./motion";
import { useScene } from "./Scene";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Kökte tanımlı marka rengi (panel kapısı aynı renkle açılsın). */
function rootBrand(): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return HEX.test(v) ? v : null;
}

export function useDoorExit() {
  const router = useRouter();
  const { handle, face } = useScene();
  const ref = useRef<DoorHandle>(null);

  const exit = useCallback(
    async (to: string) => {
      router.prefetch(to);
      const geom = await handle.depart();
      ref.current?.cover(geom);
      await ref.current?.drawLines();
      armDoor(geom, { ...face, color: face.color ?? rootBrand() }, prefersReducedMotion() ? "closed" : "lines");
      router.replace(to);
    },
    [router, handle, face],
  );

  return { exit, door: <Door ref={ref} face={face} /> };
}
