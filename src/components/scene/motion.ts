/**
 * Sahne ve kapı için küçük hareket yardımcıları (yalnız tarayıcıda çağrılır).
 *
 * - ambient(): sonsuz döngü; faz duvar saatine kilitli, böylece aynı öğenin farklı kopyaları
 *   (giriş sahnesi, kapı yarıları) aynı karede aynı konumdadır ve geçişte zıplama olmaz.
 * - play(): tek seferlik geçiş; Animation.finished döner.
 * Kayıtlı tüm animasyonlar sekme gizlenince duraklar, görünür olunca sürer (döngüler fazı yeniden kilitler).
 */

const live = new Set<{ anim: Animation; period: number | null }>();
let wired = false;

function wireVisibility() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    for (const entry of live) {
      if (hidden) entry.anim.pause();
      else {
        if (entry.period !== null) entry.anim.currentTime = Date.now() % entry.period;
        entry.anim.play();
      }
    }
  });
}

function track(anim: Animation, period: number | null) {
  wireVisibility();
  const entry = { anim, period };
  live.add(entry);
  const drop = () => live.delete(entry);
  anim.addEventListener("cancel", drop);
  if (period === null) anim.addEventListener("finish", drop);
  if (document.visibilityState === "hidden") anim.pause();
  return anim;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Sonsuz, faz kilitli döngü. Azaltılmış harekette null döner (öğe durağan kalır). */
export function ambient(
  el: Element | null,
  keyframes: Keyframe[],
  duration: number,
  opts: Omit<KeyframeAnimationOptions, "duration" | "iterations"> = {},
): Animation | null {
  if (!el || prefersReducedMotion()) return null;
  const anim = el.animate(keyframes, { easing: "linear", ...opts, duration, iterations: Infinity });
  anim.currentTime = Date.now() % (duration * (opts.direction?.startsWith("alternate") ? 2 : 1));
  return track(anim, duration * (opts.direction?.startsWith("alternate") ? 2 : 1));
}

/** Tek seferlik geçiş; bittiğinde (ya da iptal edildiğinde) çözülür. */
export function play(el: Element | null, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (!el) return Promise.resolve();
  const anim = track(el.animate(keyframes, opts), null);
  return anim.finished.then(
    () => undefined,
    () => undefined,
  );
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Yanlış girişte yatay sallama (ör. PIN noktaları). */
export function shake(el: Element | null): Promise<void> {
  if (!el) return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();
  return play(
    el,
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-10px)" },
      { transform: "translateX(9px)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(-2px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 420, easing: "cubic-bezier(.36,.07,.19,.97)" },
  );
}

export const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
export const EASE_DOOR = "cubic-bezier(.76,0,.18,1)";

/* Kapı koreografisi süreleri (ms). Açılış: kart söner (FADE) → logo çerçevesi parlar (GLOW) →
   ışınlar köşelere (RAYS) → gezinme → pistonlu ayrılma (SPLIT). Toplam ~3.3 sn + gezinme. */
export const T_FADE = 320;
export const T_GLOW = 700;
export const T_RAYS = 1000;
export const T_SPLIT = 1350;
export const T_MERGE = 1150;
export const T_RETRACT = 800;
export const T_REDUCED = 200;
