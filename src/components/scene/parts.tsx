"use client";

/**
 * Sahnenin yüzü: durağan zemin ve amblem (logo dairesi + halkalar + parlama çerçevesi).
 * Scene ve Door aynı parçaları kullanır; döngüler duvar saatine kilitli olduğundan (motion.ambient)
 * kapı kopyası, altındaki sahneyle aynı karede birebir örtüşür.
 */

import { forwardRef, useEffect, useId, useRef, type CSSProperties } from "react";
import { ambient } from "./motion";
import s from "./scene.module.css";

export type Face = {
  /** Mağaza adı; boşsa amblem işaretsiz kalır. */
  name: string;
  /** Renk (#rrggbb ya da CSS değeri); null ise --brand. */
  color: string | null;
  logo: string | null;
};

export function faceStyle(face: Face): CSSProperties | undefined {
  return face.color ? ({ "--sc": face.color } as CSSProperties) : undefined;
}

export function initialOf(name: string): string {
  return (name.trim()[0] ?? "").toLocaleUpperCase("tr");
}

/* ---------- arka plan ---------- */

/**
 * Durağan zemin (sahne ve kapı yarıları ortak): taban, logonun arkasında vurgu renginde yumuşak ışık,
 * kenarlarda vinyet. Hareketli ışık neon akıştan gelir (yalnız sahnede; kapı yarıları bu durağan zemindir).
 */
export function Backdrop() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <div className={s.vignette} />
    </div>
  );
}

/* ---------- amblem ---------- */

type EmblemProps = {
  face: Face;
  /** Giriş koreografisi (halkalar çizilir, logo oturur). Kapı kopyasında kapalı. */
  intro?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * 200 birimlik viewBox: logo r=50 (çerçeve + parlama r=51), iç halka r=64, segmentli dış halka r=80,
 * nefes halkası r=56. Boyut dışarıdan (genişlik = yükseklik) verilir.
 */
export const Emblem = forwardRef<HTMLDivElement, EmblemProps>(function Emblem({ face, intro = false, className, style }, fwd) {
  const own = useRef<HTMLDivElement | null>(null);
  const maskId = useId().replace(/:/g, "");
  useEffect(() => {
    const root = own.current;
    if (!root) return;
    const q = (k: string) => root.querySelector(`[data-a="${k}"]`);
    const spin = (deg: number): Keyframe[] => [{ transform: "rotate(0deg)" }, { transform: `rotate(${deg}deg)` }];
    const anims = [
      ambient(q("ring1"), spin(360), 32000),
      ambient(q("ring2"), spin(-360), 48000),
      ambient(q("orbit1"), spin(360), 11000),
      ambient(q("orbit2"), spin(-360), 17000),
      ambient(
        q("breath"),
        [
          { transform: "scale(1)", opacity: 0.75 },
          { transform: "scale(1.09)", opacity: 0.12 },
        ],
        4000,
        { easing: "ease-in-out", direction: "alternate" },
      ),
    ];
    return () => anims.forEach((a) => a?.cancel());
  }, []);
  const mark = initialOf(face.name);
  return (
    <div
      ref={(el) => {
        own.current = el;
        if (typeof fwd === "function") fwd(el);
        else if (fwd) fwd.current = el;
      }}
      className={`${s.emblem} ${intro ? s.intro : ""} ${className ?? ""}`}
      style={style}
      data-scene-emblem=""
      aria-hidden="true"
    >
      <div className={s.halo} data-a="halo" />
      <svg className={s.ring} data-a="breath" viewBox="0 0 200 200">
        <circle className={s.breathC} cx="100" cy="100" r="56" />
      </svg>
      <svg className={s.ring} data-a="ring1" viewBox="0 0 200 200">
        <circle className={s.ring1C} cx="100" cy="100" r="64" pathLength={100} transform="rotate(-90 100 100)" />
      </svg>
      <svg className={s.ring} data-a="ring2" viewBox="0 0 200 200">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
            <circle className={s.ring2Mask} cx="100" cy="100" r="80" pathLength={100} transform="rotate(-90 100 100)" />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          <circle className={s.ring2C} cx="100" cy="100" r="80" pathLength={100} />
        </g>
      </svg>
      <div className={s.orbit} data-a="orbit1">
        <i className={`${s.spark} ${s.sparkOuter}`} />
      </div>
      <div className={s.orbit} data-a="orbit2">
        <i className={`${s.spark} ${s.sparkInner}`} />
      </div>
      <svg className={s.ring} data-a="pulse" viewBox="0 0 200 200">
        <circle className={s.pulseC} cx="100" cy="100" r="58" />
      </svg>
      <svg className={s.ring} data-a="danger" viewBox="0 0 200 200">
        <circle className={s.dangerC} cx="100" cy="100" r="64" />
      </svg>
      <div className={s.mark} data-a="mark">
        {face.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={face.logo} alt="" />
        ) : (
          <span>{mark}</span>
        )}
      </div>
      <svg className={`${s.ring} ${s.flare}`} data-a="flare" viewBox="0 0 200 200">
        <circle className={s.flareWide} cx="100" cy="100" r="51" />
        <circle className={s.flareCore} cx="100" cy="100" r="51" />
      </svg>
    </div>
  );
});
