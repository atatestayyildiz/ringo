"use client";

/**
 * Açılış sahnesi: ışık bulutları, taralı diskler, ortada logo dairesi + dönen halkalar; altında içerik (form).
 *
 * Kullanım:
 *   <Scene ref={sceneRef} brandName={b.name} brandColor={b.color} logoUrl={b.logo} mode="lock">
 *     <div data-scene-shake>{noktalar}</div>  // error() bu öğeleri sallar
 *     <PinPad ... />
 *   </Scene>
 *   sceneRef.current.pulse()   // PIN tuşunda halka nabzı
 *   sceneRef.current.error()   // yanlışta: halka kısa kırmızı + [data-scene-shake] sallanır
 *   await sceneRef.current.depart() // içerik söner, halka parlar (0.3 sn); kapı için amblem ölçüsünü döner
 *   sceneRef.current.arrive()  // depart geri alınır (ör. gezinme başarısız)
 * Çocuklar useScene() ile aynı tutamağa ve marka yüzüne erişebilir.
 * Marka rengi brandColor (#rrggbb) yoksa --brand. Azaltılmış harekette yalnız solma.
 * Kapı panelde kapanıp buraya gelindiyse (armArrival) giriş koreografisi atlanır: amblem kapının
 * bıraktığı konumdan kendi yerine kayar, içerik belirir. mode="lock" amblem konumunu sonraki
 * kapanış için saklar (saveLockEmblem).
 */

import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from "react";
import { clearArrival, docState, parseArrival, readArrivalRaw, saveLockEmblem } from "./doorFlag";
import { EASE_OUT, play, prefersReducedMotion, shake } from "./motion";
import { Backdrop, Emblem, faceStyle, type Face } from "./parts";
import s from "./scene.module.css";

/** Sahne içeriği için cam kart sınıfı (ör. <Card className={sceneGlass}>). */
export const sceneGlass = s.glass;

export type EmblemSnapshot = {
  /** Amblem merkezi, görünür alan pikselinde. */
  cx: number;
  cy: number;
  /** Amblem kutusunun kenarı (px). */
  size: number;
};

export type SceneHandle = {
  pulse(): void;
  error(): void;
  depart(): Promise<EmblemSnapshot>;
  arrive(): void;
  emblem(): EmblemSnapshot | null;
};

type SceneCtx = { handle: SceneHandle; face: Face };
const Ctx = createContext<SceneCtx | null>(null);

/** Sahne içindeki bileşenler için tutamak + marka yüzü. */
export function useScene(): SceneCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useScene yalnız <Scene> içinde kullanılır.");
  return v;
}

export type SceneProps = {
  brandName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  mode?: "login" | "lock";
  /** Amblem + mağaza adı bloğuna test kimliği. */
  brandTestId?: string;
  children: ReactNode;
  ref?: Ref<SceneHandle>;
};

const noopSub = () => () => {};

/** Ekran koordinatında amblem ölçüsü. */
function measure(el: HTMLElement | null): EmblemSnapshot | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width };
}

export function Scene({ brandName, brandColor = null, logoUrl = null, mode = "login", brandTestId, children, ref }: SceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const emblemRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLParagraphElement>(null);
  const par = useRef({ tx: 0, ty: 0, x: 0, y: 0, frozen: false });

  // Varış bayrağı yalnız istemci gezinmesinde okunur (sunucu/hidrasyon: null); ilk değer sabitlenir.
  const arrivalRaw = useSyncExternalStore(noopSub, readArrivalRaw, () => null);
  const [arrivalFrom] = useState(() => (typeof window !== "undefined" && docState.painted ? arrivalRaw : null));
  useEffect(() => {
    docState.painted = true;
    if (!arrivalFrom) clearArrival();
  }, [arrivalFrom]);
  const arriving = arrivalFrom !== null;

  useLayoutEffect(() => {
    const em = emblemRef.current;
    if (!em) return;
    const real = measure(em);
    if (real && mode === "lock") saveLockEmblem(real);
    if (!arrivalFrom) return;
    clearArrival();
    const from = parseArrival(arrivalFrom);
    if (!from || !real || prefersReducedMotion()) return;
    const dx = from.cx - real.cx;
    const dy = from.cy - real.cy;
    const k = from.size / real.size;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(k - 1) < 0.005) return;
    void play(em, [{ transform: `translate(${dx}px,${dy}px) scale(${k})` }, { transform: "none" }], { duration: 650, easing: EASE_OUT });
  }, [arrivalFrom, mode]);

  const face = useMemo<Face>(() => ({ name: brandName, color: brandColor, logo: logoUrl }), [brandName, brandColor, logoUrl]);

  /* ---- paralaks: imleç (fare) ya da dokunup sürükleme; yalnız transform ---- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const layers: [HTMLElement | null, number][] = [
      [root.querySelector<HTMLElement>('[data-layer="aura"]'), -26],
      [root.querySelector<HTMLElement>('[data-layer="hatch"]'), 14],
      [root.querySelector<HTMLElement>("[data-parallax]"), 9],
    ];
    const p = par.current;
    let raf = 0;
    let touch: { x: number; y: number; id: number } | null = null;
    const tick = () => {
      raf = 0;
      p.x += (p.tx - p.x) * 0.09;
      p.y += (p.ty - p.y) * 0.09;
      for (const [el, k] of layers) if (el) el.style.transform = `translate3d(${(p.x * k).toFixed(2)}px,${(p.y * k).toFixed(2)}px,0)`;
      if (Math.abs(p.tx - p.x) > 0.002 || Math.abs(p.ty - p.y) > 0.002) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && document.visibilityState === "visible") raf = requestAnimationFrame(tick);
    };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const onMove = (e: PointerEvent) => {
      if (p.frozen) return;
      if (e.pointerType === "mouse") {
        p.tx = clamp((e.clientX / innerWidth) * 2 - 1);
        p.ty = clamp((e.clientY / innerHeight) * 2 - 1);
      } else if (touch && e.pointerId === touch.id) {
        p.tx = clamp((e.clientX - touch.x) / 160);
        p.ty = clamp((e.clientY - touch.y) / 160);
      } else return;
      kick();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      if (touch && e.pointerId === touch.id) {
        touch = null;
        p.tx = 0;
        p.ty = 0;
        kick();
      }
    };
    const onLeave = () => {
      p.tx = 0;
      p.ty = 0;
      kick();
    };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });
    addEventListener("pointerup", onUp, { passive: true });
    addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const handle = useMemo<SceneHandle>(() => {
    const part = (k: string) => emblemRef.current?.querySelector(`[data-a="${k}"]`) ?? null;
    const resetParallax = () => {
      const p = par.current;
      p.frozen = true;
      p.tx = p.ty = p.x = p.y = 0;
      rootRef.current?.querySelectorAll<HTMLElement>("[data-layer],[data-parallax]").forEach((el) => (el.style.transform = ""));
    };
    return {
      pulse() {
        if (prefersReducedMotion()) return;
        void play(
          part("pulse"),
          [
            { transform: "scale(.92)", opacity: 0.95 },
            { transform: "scale(1.22)", opacity: 0 },
          ],
          { duration: 520, easing: EASE_OUT },
        );
        void play(part("mark"), [{ transform: "scale(1)" }, { transform: "scale(.965)" }, { transform: "scale(1)" }], {
          duration: 220,
          easing: "ease-out",
        });
      },
      error() {
        const reduced = prefersReducedMotion();
        void play(part("danger"), [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], {
          duration: reduced ? 400 : 700,
          easing: "ease-out",
        });
        contentRef.current?.querySelectorAll("[data-scene-shake]").forEach((el) => void shake(el));
      },
      async depart() {
        const content = contentRef.current;
        if (content) content.inert = true;
        if (prefersReducedMotion()) {
          resetParallax();
          return measure(emblemRef.current) ?? { cx: innerWidth / 2, cy: innerHeight / 2, size: 180 };
        }
        // Paralaks sıfırlanırken amblem kayar; ölçüyü animasyon sonunda al.
        const settle = rootRef.current?.querySelectorAll<HTMLElement>("[data-layer],[data-parallax]") ?? [];
        settle.forEach((el) => {
          if (el.style.transform) void play(el, [{ transform: el.style.transform }, { transform: "translate3d(0,0,0)" }], { duration: 300, easing: EASE_OUT });
        });
        resetParallax();
        await Promise.all([
          play(content, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(18px) scale(.98)" }], {
            duration: 300,
            easing: "cubic-bezier(.4,0,1,1)",
            fill: "forwards",
          }),
          play(nameRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-in", fill: "forwards" }),
          play(part("halo"), [{ opacity: 0.5, transform: "scale(.9)" }, { opacity: 1, transform: "scale(1.08)" }], {
            duration: 300,
            easing: EASE_OUT,
            fill: "forwards",
          }),
        ]);
        return measure(emblemRef.current) ?? { cx: innerWidth / 2, cy: innerHeight / 2, size: 180 };
      },
      arrive() {
        const content = contentRef.current;
        par.current.frozen = false;
        if (!content) return;
        content.inert = false;
        content.getAnimations().forEach((a) => a.cancel());
        nameRef.current?.getAnimations().forEach((a) => a.cancel());
        part("halo")?.getAnimations().forEach((a) => a.cancel());
      },
      emblem: () => measure(emblemRef.current),
    };
  }, []);

  useImperativeHandle(ref, () => handle, [handle]);
  const ctx = useMemo(() => ({ handle, face }), [handle, face]);

  return (
    <Ctx.Provider value={ctx}>
      <div ref={rootRef} className={s.scene} data-mode={mode} data-arrive={arriving ? "" : undefined} style={faceStyle(face)}>
        <Backdrop />
        <div className={s.stage}>
          <div className={s.top} data-parallax="" data-testid={brandTestId}>
            <Emblem ref={emblemRef} face={face} intro={!arriving} className={s.sceneEmblem} />
            {brandName.trim() ? (
              <p ref={nameRef} className={s.brandName}>
                {brandName}
              </p>
            ) : null}
          </div>
          <div ref={contentRef} className={s.content}>
            {children}
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}
