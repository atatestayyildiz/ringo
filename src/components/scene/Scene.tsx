"use client";

/**
 * Açılış sahnesi: en arkada neon akış, tam ortada (yatay + dikey) yuvarlak logo ve halkalar,
 * alt ortada bölme (giriş kartı ya da PIN daireleri), en altta imza.
 *
 * Kullanım:
 *   <Scene ref={sceneRef} brandName={b.name} brandColor={b.color} logoUrl={b.logo} mode="lock" footer={<MadeBy />}>
 *     <PinField ... />          // alt bölme; [data-scene-shake] öğeleri error()'da sallanır
 *   </Scene>
 *   sceneRef.current.pulse()   // tuşta halka nabzı
 *   sceneRef.current.error()   // yanlışta: halka kısa kırmızı + [data-scene-shake] sallanır
 *   await sceneRef.current.depart() // klavye kapanır + bölme söner, sonra logo çerçevesi parlar, neon söner
 *   sceneRef.current.arrive()  // depart geri alınır (ör. gezinme başarısız)
 * Çocuklar useScene() ile aynı tutamağa ve marka yüzüne erişebilir.
 * Logo yerleşim görünür alanına sabittir: mobil tarayıcı çubukları ya da klavye onu kaydırmaz; klavye
 * açıkken alt bölme klavyenin üstüne çıkar (--kb), logo soluklaşır. Azaltılmış harekette neon yok, yalnız solma.
 * Kapı panelde kapanıp buraya gelindiyse (armArrival) giriş koreografisi atlanır: parlama söner, neon ve bölme belirir.
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
import { TubesBackground } from "@/components/ui/neon-flow";
import { clearArrival, docState, parseArrival, readArrivalRaw } from "./doorFlag";
import { closeKeyboard, trackKeyboard } from "./keyboard";
import { hardwareGraphics, watchFrames } from "./neonGuard";
import { EASE_OUT, play, prefersReducedMotion, shake, T_FADE, T_GLOW } from "./motion";
import { Backdrop, Emblem, faceStyle, type Face } from "./parts";
import s from "./scene.module.css";

/** Sahne içeriği için cam kart sınıfı. */
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
  /** En alttaki imza satırı (klavye açıkken gizlenir). */
  footer?: ReactNode;
  children: ReactNode;
  ref?: Ref<SceneHandle>;
};

const noopSub = () => () => {};

function subscribeMotion(cb: () => void) {
  if (typeof matchMedia === "undefined") return () => {};
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Neon akış yalnız istemcide, hareket azaltılmamışsa ve grafik donanım hızlandırmalıysa. */
function useNeon(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => !prefersReducedMotion() && hardwareGraphics(),
    () => false,
  );
}

/** Ekran koordinatında amblem ölçüsü. */
function measure(el: HTMLElement | null): EmblemSnapshot | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width };
}

const fallbackGeom = (): EmblemSnapshot => ({ cx: innerWidth / 2, cy: innerHeight / 2, size: 180 });

export function Scene({ brandName, brandColor = null, logoUrl = null, mode = "login", brandTestId, footer, children, ref }: SceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const emblemRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLParagraphElement>(null);
  const neonRef = useRef<HTMLDivElement>(null);
  const neonAllowed = useNeon();
  const [neonSlow, setNeonSlow] = useState(false);
  const neon = neonAllowed && !neonSlow;

  // Neon hazır olunca kare hızı ölçülür; cihaz kaldıramıyorsa efekt kapanır (WebGL bağlamı bırakılır).
  useEffect(() => {
    const host = neonRef.current;
    if (!neon || !host) return;
    let stopWatch: (() => void) | null = null;
    const start = () => {
      if (stopWatch || host.querySelector('[data-neon="ready"]') === null) return;
      stopWatch = watchFrames(() => setNeonSlow(true));
    };
    const mo = new MutationObserver(start);
    mo.observe(host, { subtree: true, attributes: true, attributeFilter: ["data-neon"] });
    start();
    return () => {
      mo.disconnect();
      stopWatch?.();
    };
  }, [neon]);

  // Varış bayrağı yalnız istemci gezinmesinde okunur (sunucu/hidrasyon: null); ilk değer sabitlenir.
  const arrivalRaw = useSyncExternalStore(noopSub, readArrivalRaw, () => null);
  const [arrivalFrom] = useState(() => (typeof window !== "undefined" && docState.painted ? arrivalRaw : null));
  useEffect(() => {
    docState.painted = true;
    if (!arrivalFrom) clearArrival();
  }, [arrivalFrom]);
  const arriving = arrivalFrom !== null;

  // Kapının bıraktığı amblem konumundan (pencere boyu farkı ya da kaydırma çubuğu) gerçek yerine kısa kayış.
  useLayoutEffect(() => {
    const em = emblemRef.current;
    if (!em || !arrivalFrom) return;
    clearArrival();
    const from = parseArrival(arrivalFrom);
    const real = measure(em);
    if (!from || !real || prefersReducedMotion()) return;
    const dx = from.cx - real.cx;
    const dy = from.cy - real.cy;
    const k = from.size / real.size;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(k - 1) < 0.005) return;
    void play(em, [{ transform: `translate(${dx}px,${dy}px) scale(${k})` }, { transform: "none" }], { duration: 650, easing: EASE_OUT });
  }, [arrivalFrom]);

  // Klavye payı: alt bölme klavyenin üstüne çıkar, logo yerinde kalır.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return trackKeyboard(root);
  }, []);

  const face = useMemo<Face>(() => ({ name: brandName, color: brandColor, logo: logoUrl }), [brandName, brandColor, logoUrl]);

  const handle = useMemo<SceneHandle>(() => {
    const part = (k: string) => emblemRef.current?.querySelector(`[data-a="${k}"]`) ?? null;
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
        const keyboard = closeKeyboard(400);
        if (prefersReducedMotion()) {
          await keyboard;
          return measure(emblemRef.current) ?? fallbackGeom();
        }
        const out: KeyframeAnimationOptions = { duration: T_FADE, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" };
        // 1) Önce bölme söner ve klavye kapanır.
        await Promise.all([
          keyboard,
          play(content, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(10px)" }], out),
          play(footRef.current, [{ opacity: 1 }, { opacity: 0 }], out),
        ]);
        // 2) Logo çerçevesi kuvvetle parlar; neon ve mağaza adı söner (kapı yarıları durağan zemindir).
        const glow: KeyframeAnimationOptions = { duration: T_GLOW, easing: "cubic-bezier(.3,0,.2,1)", fill: "forwards" };
        await Promise.all([
          play(part("flare"), [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1.035)", offset: 0.7 }, { opacity: 1, transform: "scale(1)" }], glow),
          play(part("halo"), [{ opacity: 0.5, transform: "scale(.9)" }, { opacity: 1, transform: "scale(1.08)" }], glow),
          play(neonRef.current, [{ opacity: 1 }, { opacity: 0 }], { ...glow, easing: "ease-in" }),
          play(nameRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: T_GLOW * 0.5, easing: "ease-in", fill: "forwards" }),
        ]);
        return measure(emblemRef.current) ?? fallbackGeom();
      },
      arrive() {
        const content = contentRef.current;
        if (!content) return;
        content.inert = false;
        for (const el of [content, footRef.current, nameRef.current, neonRef.current, part("halo"), part("flare")]) {
          el?.getAnimations().forEach((a) => a.cancel());
        }
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
        {neon ? (
          <div ref={neonRef} className={s.neon} data-testid="neon-flow">
            <TubesBackground className={s.neonInner} />
          </div>
        ) : null}
        <div className={s.center} data-testid={brandTestId}>
          <Emblem ref={emblemRef} face={face} intro={!arriving} className={s.sceneEmblem} />
          {brandName.trim() ? (
            <p ref={nameRef} className={s.brandName}>
              {brandName}
            </p>
          ) : null}
        </div>
        <div ref={contentRef} className={s.dock}>
          {children}
        </div>
        {footer ? (
          <div ref={footRef} className={s.foot}>
            {footer}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}
