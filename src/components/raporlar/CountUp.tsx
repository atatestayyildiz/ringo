"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { pct } from "./types";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Sayma yalnız sayfa ilk açıldığında oynar: aynı ilk boyamada bağlanan sayılar birlikte animasyona girer,
// sonraki (yumuşak) gezinmelerde değer doğrudan görünür.
let firstMount: number | null = null;

const DURATION = 600;

/**
 * İri sayı. Sunucu çıktısında ve JS yokken son değer metindedir; sayma yalnız süstür.
 * kind="pct": value 0-1 arası oran, metin pct() ile aynı biçimde ("%41,3").
 */
export function CountUp({ value, kind = "int" }: { value: number; kind?: "int" | "pct" }) {
  const [frame, setFrame] = useState<number | null>(null);
  const fmt = (v: number) => (kind === "pct" ? pct(v) : String(Math.round(v)));

  useIso(() => {
    const now = performance.now();
    if (firstMount === null) firstMount = now;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || now - firstMount > 500 || value <= 0) return;

    let raf = 0;
    const t0 = performance.now();
    setFrame(0);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p >= 1) {
        setFrame(null);
        return;
      }
      setFrame(value * eased);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{frame === null ? fmt(value) : fmt(frame)}</>;
}
