"use client";

import React, { useEffect, useRef, useState } from "react";
import type { TubesApp } from "threejs-components/build/cursors/tubes1.min.js";
import { cn } from "@/lib/utils";

/*
 * Neon akış (kullanıcının verdiği bileşen). Farklar (onaylı):
 * - Kütüphane CDN yerine yerel paketten (threejs-components@0.0.19, aynı build dosyası) bundler ile
 *   dinamik içe aktarılır; dış ağ isteği yok.
 * - Kullanılmayan framer-motion içe aktarımı yok; cn yerel yardımcı.
 * - Renk karıştırma yalnız boş arka plana tıklayınca (ön katmanlara tıklama renk değiştirmez).
 * - Azaltılmış harekette efekt hiç başlamaz; unmount'ta kütüphane dispose edilir, döngü bir daha
 *   başlayamaz ve WebGL bağlamı serbest bırakılır. Sekme gizliyken kütüphanenin kendisi durur.
 */

const randomColors = (count: number) => {
  return new Array(count)
    .fill(0)
    .map(() => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"));
};

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

function prefersReducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Kütüphanenin dispose'u görünürlük/yeniden boyut dinleyicilerini sökemiyor: döngüyü kalıcı sustur, bağlamı bırak. */
function teardown(app: TubesApp, canvas: HTMLCanvasElement | null) {
  try {
    app.dispose();
  } catch {
    // zaten sökülmüş
  }
  try {
    app.three.renderer.setAnimationLoop(null);
    app.three.renderer.setAnimationLoop = () => {};
    app.three.resize = () => {};
  } catch {
    // yok say
  }
  try {
    const gl = (canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // bağlam yok
  }
}

export function TubesBackground({ children, className, enableClickInteraction = true }: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const tubesRef = useRef<TubesApp | null>(null);

  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;
    const canvas = canvasRef.current;

    const initTubes = async () => {
      if (!canvas || prefersReducedMotion()) return;
      try {
        const lib = await import("threejs-components/build/cursors/tubes1.min.js");
        const TubesCursor = lib.default;
        if (!mounted) return;

        const app = TubesCursor(canvas, {
          tubes: {
            colors: ["#f967fb", "#53bc28", "#6958d5"],
            lights: {
              intensity: 200,
              colors: ["#83f36e", "#fe8a2e", "#ff008a", "#60aed5"],
            },
          },
        });

        tubesRef.current = app;
        setIsLoaded(true);

        const handleResize = () => {
          // Kütüphane yeniden boyutu kendisi izliyor (ResizeObserver).
        };
        window.addEventListener("resize", handleResize);
        cleanup = () => {
          window.removeEventListener("resize", handleResize);
          teardown(app, canvas);
          tubesRef.current = null;
        };
      } catch (error) {
        console.error("Failed to load TubesCursor:", error);
      }
    };

    void initTubes();

    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableClickInteraction || !tubesRef.current) return;
    // Yalnız boş arka plan: kanvas ya da bileşenin kendi zemini.
    if (e.target !== canvasRef.current && e.target !== e.currentTarget) return;
    const colors = randomColors(3);
    const lightsColors = randomColors(4);
    tubesRef.current.tubes.setColors(colors);
    tubesRef.current.tubes.setLightsColors(lightsColors);
  };

  return (
    <div
      className={cn("relative w-full h-full min-h-[400px] overflow-hidden bg-background", className)}
      onClick={handleClick}
      data-neon={isLoaded ? "ready" : "idle"}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" style={{ touchAction: "none" }} />
      {children ? <div className="relative z-10 w-full h-full pointer-events-none">{children}</div> : null}
    </div>
  );
}

export default TubesBackground;
