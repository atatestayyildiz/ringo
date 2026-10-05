"use client";

/**
 * Köşegen kapı: ekranı kaplayan sahne kopyası (durağan zemin + amblem), logo çerçevesinden sağ üst ve
 * sol alt köşeye uzanan ışın boyunca (clip-path) iki parçaya bölünür. Logo tam merkezde olduğundan
 * kesik köşeden köşeye düz köşegendir.
 *
 * Kullanım (imperatif):
 *   const door = useRef<DoorHandle>(null);
 *   <Door ref={door} face={{ name, color, logo }} />   // açık (görünmez) başlar
 *   door.current.cover(geom)       // anında kapalı: sahne kopyası tüm ekranı örter, çerçeve parlıyor
 *   await door.current.drawLines() // ışınlar köşelere ilerler, uçta parlak nokta (T_RAYS)
 *   await door.current.split(main) // pistonlu ayrılma: ani sıçrama + titreşim, yumuşak açılış, yavaşlama (T_SPLIT)
 *   await door.current.close(geom) // ters: yarılar gelip birleşir (T_MERGE), ışınlar logoya çekilir (T_RETRACT)
 * Ya da başlangıç durumu ile: <Door face initial={{ geom, stage: "lines" }} /> (ilk boyamada kapalı).
 * geom = Scene.depart()/emblem() ölçüsü; verilmezse ekran merkezi. Azaltılmış harekette yalnız 200 ms solma.
 * Kapı document.body'ye portal ile basılır; kapalıyken tıklamayı yutar, ayrılmaya başlar başlamaz yutmaz.
 */

import { useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import type { EmblemSnapshot } from "./Scene";
import { play, prefersReducedMotion, T_MERGE, T_RAYS, T_REDUCED, T_RETRACT, T_SPLIT } from "./motion";
import { Backdrop, Emblem, faceStyle, type Face } from "./parts";
import s from "./scene.module.css";

export type DoorStage = "open" | "closed" | "lines";

export type DoorHandle = {
  cover(geom?: EmblemSnapshot): void;
  drawLines(): Promise<void>;
  split(reveal?: Element | null): Promise<void>;
  open(reveal?: Element | null): Promise<void>;
  merge(geom?: EmblemSnapshot): Promise<void>;
  retract(): Promise<void>;
  close(geom?: EmblemSnapshot): Promise<void>;
};

export type DoorProps = {
  face: Face;
  initial?: { geom: EmblemSnapshot | null; stage: Exclude<DoorStage, "open"> } | null;
  ref?: Ref<DoorHandle>;
};

const noop = () => () => {};

/** Ölçüler: ekran, amblem, ışın boyları, köşegen birim vektörleri. */
type Geo = { W: number; H: number; cx: number; cy: number; size: number; L1: number; L2: number; n: [number, number]; t: [number, number] };

/** Işının logo çerçevesinden başladığı yarıçap (amblem kenarına oran; çerçeve r=51/200). */
const FRAME = 0.255;

/** Kapı yarısının yol eğrisi: piston boşalması (ani sıçrama + titreşim), yumuşak açılış, sonda yavaşlama. */
function pistonFrames(g: Geo, sign: 1 | -1, out: boolean): Keyframe[] {
  const [nx, ny] = g.n;
  const [tx, ty] = g.t;
  // a yarısı sol üste (sign -1: normalin tersi değil; normal sol üstü gösterir), b sağ alta.
  const k = sign;
  const end = { x: k * -g.W, y: k * -g.H };
  const at = (j: number, w: number, f = 0) => {
    const x = k * nx * j + k * tx * w + end.x * f;
    const y = k * ny * j + k * ty * w + end.y * f;
    return `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
  };
  if (!out) {
    // Kapanış: köşelerden hızlanarak gelir, birleşmede küçük geri tepme.
    return [
      { transform: at(0, 0, 1), easing: "cubic-bezier(.5,0,.85,.45)" },
      { transform: at(0, 0, 0), offset: 0.86, easing: "cubic-bezier(.2,.8,.3,1)" },
      { transform: at(5, 0.8), offset: 0.92, easing: "cubic-bezier(.4,0,.6,1)" },
      { transform: at(0, 0, 0) },
    ];
  }
  const J = 11; // sıçrama (px)
  return [
    { transform: at(0, 0), easing: "cubic-bezier(.05,.9,.2,1)" },
    { transform: at(J, 0), offset: 0.045, easing: "linear" },
    { transform: at(J * 0.7, 1.8), offset: 0.062, easing: "linear" },
    { transform: at(J * 0.95, -1.4), offset: 0.078, easing: "linear" },
    { transform: at(J * 0.8, 0.8), offset: 0.094, easing: "linear" },
    { transform: at(J * 0.88, 0), offset: 0.11, easing: "ease-out" },
    { transform: at(J * 0.9, 0), offset: 0.16, easing: "cubic-bezier(.55,0,.7,.4)" },
    { transform: at(J * 0.9 * 0.4, 0, 0.6), offset: 0.64, easing: "cubic-bezier(.2,.55,.25,1)" },
    { transform: at(0, 0, 1) },
  ];
}

export function Door({ face, initial = null, ref }: DoorProps) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const root = useRef<HTMLDivElement>(null);
  const geo = useRef<Geo | null>(null);
  const initialRef = useRef(initial);

  const q = <T extends Element = HTMLElement>(sel: string) => root.current?.querySelector<T & Element>(sel) ?? null;
  const qa = (sel: string) => Array.from(root.current?.querySelectorAll<HTMLElement | SVGElement>(sel) ?? []);

  const setStage = (st: DoorStage | "split") => {
    if (root.current) root.current.dataset.stage = st;
  };
  const setBlocking = (on: boolean) => {
    if (root.current) root.current.style.pointerEvents = on ? "" : "none";
  };

  /** Ölçüleri yerleştirir: amblemler, kırpma çokgenleri, ek yeri ve ışınlar. */
  const apply = (g?: EmblemSnapshot | null) => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = r.width || innerWidth;
    const H = r.height || innerHeight;
    const prev = geo.current;
    const size = g?.size ?? prev?.size ?? 180;
    const cx = g?.cx ?? W / 2;
    const cy = g?.cy ?? H / 2;
    for (const em of qa("[data-scene-emblem]")) {
      const st = (em as HTMLElement).style;
      st.width = st.height = `${size}px`;
      st.left = `${cx - size / 2}px`;
      st.top = `${cy - size / 2}px`;
    }
    const a = q<HTMLElement>('[data-f="a"]');
    const b = q<HTMLElement>('[data-f="b"]');
    if (a) a.style.clipPath = `polygon(0px 0px, ${W}px 0px, ${cx}px ${cy}px, 0px ${H}px)`;
    if (b) b.style.clipPath = `polygon(${W}px 0px, ${W}px ${H}px, 0px ${H}px, ${cx}px ${cy}px)`;
    for (const svg of qa("svg[data-full]")) svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    for (const pl of qa("[data-seam]")) pl.setAttribute("points", `${W},0 ${cx},${cy} 0,${H}`);
    const rr = size * FRAME;
    const seg = (tx: number, ty: number) => {
      const dx = tx - cx;
      const dy = ty - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { sx: cx + (dx / d) * rr, sy: cy + (dy / d) * rr, tx, ty, L: Math.max(1, d - rr) };
    };
    const s1 = seg(W, 0);
    const s2 = seg(0, H);
    for (const [k, sg] of [
      ["1", s1],
      ["2", s2],
    ] as const) {
      for (const ln of qa(`[data-line="${k}"]`)) {
        ln.setAttribute("x1", String(sg.sx));
        ln.setAttribute("y1", String(sg.sy));
        ln.setAttribute("x2", String(sg.tx));
        ln.setAttribute("y2", String(sg.ty));
        ln.style.strokeDasharray = `${sg.L} ${sg.L}`;
      }
      const tip = q<HTMLElement>(`[data-tip="${k}"]`);
      if (tip) {
        tip.style.left = `${sg.sx}px`;
        tip.style.top = `${sg.sy}px`;
        tip.dataset.dx = String(sg.tx - sg.sx);
        tip.dataset.dy = String(sg.ty - sg.sy);
      }
    }
    const D = Math.hypot(W, H) || 1;
    // t: köşegen boyunca (sağ üst → sol alt), n: köşegene dik, sol üstü gösterir.
    geo.current = { W, H, cx, cy, size, L1: s1.L, L2: s2.L, t: [-W / D, H / D], n: [-H / D, -W / D] };
  };

  /** Işınları ve uç noktalarını belirli bir orana (0 = gizli, 1 = köşede) yerleştirir. */
  const setLines = (p: 0 | 1) => {
    const g = geo.current;
    if (!g) return;
    for (const ln of qa("[data-line]")) {
      const L = ln.dataset.line === "1" ? g.L1 : g.L2;
      ln.style.strokeDashoffset = String(p ? 0 : L);
    }
    for (const tip of qa("[data-tip]")) {
      const t = tip as HTMLElement;
      t.style.transform = p ? `translate(${t.dataset.dx}px,${t.dataset.dy}px)` : "";
      t.style.opacity = p ? "1" : "0";
    }
  };

  const lineAnims = (forward: boolean, duration: number, easing: string) => {
    const g = geo.current;
    if (!g) return [];
    const out: Promise<void>[] = [];
    for (const ln of qa("[data-line]")) {
      const L = ln.dataset.line === "1" ? g.L1 : g.L2;
      const kf = [{ strokeDashoffset: String(L) }, { strokeDashoffset: "0" }];
      out.push(play(ln, forward ? kf : kf.slice().reverse(), { duration, easing, fill: "forwards" }));
    }
    for (const tip of qa("[data-tip]")) {
      const t = tip as HTMLElement;
      const kf: Keyframe[] = [
        { transform: "translate(0,0) scale(.6)", opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: `translate(${t.dataset.dx}px,${t.dataset.dy}px) scale(1)`, opacity: 1 },
      ];
      out.push(play(t, forward ? kf : kf.slice().reverse(), { duration, easing, fill: "forwards" }));
    }
    return out;
  };

  const clearAnims = () => {
    for (const el of qa("[data-line],[data-tip],[data-f],[data-seam-g]")) el.getAnimations().forEach((a) => a.cancel());
    root.current?.getAnimations().forEach((a) => a.cancel());
  };

  useImperativeHandle(ref, () => {
    const h: DoorHandle = {
      cover(g) {
        clearAnims();
        setBlocking(true);
        apply(g);
        setLines(0);
        if (root.current) root.current.dataset.glow = "";
        setStage("closed");
      },
      async drawLines() {
        if (prefersReducedMotion()) return;
        if (!geo.current) apply();
        setStage("lines");
        await Promise.all(lineAnims(true, T_RAYS, "cubic-bezier(.55,.05,.3,1)"));
        clearAnims();
        setLines(1);
      },
      async split(reveal) {
        const g = geo.current ?? (apply(), geo.current);
        if (!g) return;
        // Açılmaya başlar başlamaz panel etkileşime açık: yarılar tıklamayı/dokunmayı yutmaz.
        setBlocking(false);
        if (prefersReducedMotion()) {
          await play(root.current, [{ opacity: 1 }, { opacity: 0 }], { duration: T_REDUCED, easing: "linear", fill: "forwards" });
          setStage("open");
          clearAnims();
          return;
        }
        setStage("split");
        const opts: KeyframeAnimationOptions = { duration: T_SPLIT, easing: "linear", fill: "forwards" };
        const seam: Keyframe[] = [{ opacity: 0.5 }, { opacity: 1, offset: 0.05 }, { opacity: 0.9, offset: 0.35 }, { opacity: 0 }];
        await Promise.all([
          play(q('[data-f="a"]'), pistonFrames(g, 1, true), opts),
          play(q('[data-f="b"]'), pistonFrames(g, -1, true), opts),
          ...qa("[data-seam-g]").map((el) => play(el, seam, { duration: T_SPLIT, easing: "ease-out", fill: "forwards" })),
          reveal
            ? play(
                reveal,
                [
                  { transform: "scale(.955)", opacity: 0.2 },
                  { transform: "scale(.955)", opacity: 0.2, offset: 0.12 },
                  { transform: "scale(1)", opacity: 1 },
                ],
                { duration: T_SPLIT + 150, easing: "cubic-bezier(.3,0,.2,1)" },
              )
            : Promise.resolve(),
        ]);
        setStage("open");
        clearAnims();
      },
      async open(reveal) {
        await h.drawLines();
        await h.split(reveal);
      },
      async merge(g) {
        clearAnims();
        setBlocking(true);
        apply(g);
        if (root.current) delete root.current.dataset.glow;
        const cur = geo.current;
        if (!cur) return;
        if (prefersReducedMotion()) {
          setStage("closed");
          await play(root.current, [{ opacity: 0 }, { opacity: 1 }], { duration: T_REDUCED, easing: "linear" });
          return;
        }
        setLines(0);
        setStage("split");
        const opts: KeyframeAnimationOptions = { duration: T_MERGE, easing: "linear", fill: "forwards" };
        const seam: Keyframe[] = [{ opacity: 0 }, { opacity: 0.25, offset: 0.7 }, { opacity: 1, offset: 0.87 }, { opacity: 1 }];
        await Promise.all([
          play(q('[data-f="a"]'), pistonFrames(cur, 1, false), opts),
          play(q('[data-f="b"]'), pistonFrames(cur, -1, false), opts),
          ...qa("[data-seam-g]").map((el) => play(el, seam, { duration: T_MERGE, easing: "linear", fill: "forwards" })),
        ]);
        clearAnims();
        setLines(1);
        setStage("lines");
      },
      async retract() {
        if (prefersReducedMotion()) return;
        if (root.current) root.current.dataset.glow = "";
        await Promise.all(lineAnims(false, T_RETRACT, "cubic-bezier(.6,0,.75,.25)"));
        clearAnims();
        setLines(0);
        setStage("closed");
      },
      async close(g) {
        await h.merge(g);
        await h.retract();
      },
    };
    return h;
  });

  useLayoutEffect(() => {
    const init = initialRef.current;
    if (!init) {
      setStage("open");
      setBlocking(false);
      return;
    }
    apply(init.geom);
    if (root.current) root.current.dataset.glow = "";
    if (init.stage === "lines" && !prefersReducedMotion()) {
      setLines(1);
      setStage("lines");
    } else {
      setLines(0);
      setStage("closed");
    }
    // apply/setLines yalnız ref'lere dokunur; kurulum istemcide bir kez çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  if (!client) return null;

  const faceLayer = (key: string, cls: string) => (
    <div className={cls} data-f={key}>
      <Backdrop />
      <Emblem face={face} className={s.doorEmblem} />
      {key !== "base" ? (
        <svg className={s.seam} data-full="" data-seam-g="" preserveAspectRatio="none">
          <polyline data-seam="" className={s.seamGlow} />
          <polyline data-seam="" className={s.seamCore} />
        </svg>
      ) : null}
    </div>
  );

  return createPortal(
    <div ref={root} className={s.door} style={faceStyle(face)} data-testid="door" aria-hidden="true">
      {faceLayer("base", s.face)}
      {faceLayer("a", `${s.face} ${s.half}`)}
      {faceLayer("b", `${s.face} ${s.half}`)}
      <svg className={s.lines} data-full="" preserveAspectRatio="none">
        <line data-line="1" className={s.lineGlow} />
        <line data-line="2" className={s.lineGlow} />
        <line data-line="1" className={s.lineCore} />
        <line data-line="2" className={s.lineCore} />
      </svg>
      <i className={s.tip} data-tip="1" />
      <i className={s.tip} data-tip="2" />
    </div>,
    document.body,
  );
}
