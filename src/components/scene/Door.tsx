"use client";

/**
 * Köşegen kapı: ekranı kaplayan sahne kopyası, amblem merkezinden sağ üst ve sol alt köşeye uzanan
 * kırık çizgi boyunca (clip-path) iki parçaya bölünür; parçalar köşelere kayar. Kapanma tersidir.
 *
 * Kullanım (imperatif):
 *   const door = useRef<DoorHandle>(null);
 *   <Door ref={door} face={{ name, color, logo }} />            // açık (görünmez) başlar
 *   door.current.cover(geom)     // anında kapalı: sahne kopyası tüm ekranı örter
 *   await door.current.drawLines()  // ışıklı çizgiler köşelere çizilir (0.5 sn)
 *   await door.current.split(document.querySelector("main"))  // yarılar ayrılır, hedef hafif yakınlaşır (0.8 sn)
 *   await door.current.open()    // drawLines + split  (~1.3 sn; önündeki 0.3 sn Scene.depart())
 *   await door.current.close(geom)  // yarılar köşelerden gelir, ek yeri parlar, çizgiler logoya çekilir (~1.3 sn)
 * Ya da başlangıç durumu ile: <Door face initial={{ geom, stage: "lines" }} /> (ilk boyamada kapalı).
 * geom = Scene.depart()/emblem() ölçüsü (amblem merkezi + kenar). Azaltılmış harekette yalnız 200 ms solma.
 * Kapı document.body'ye portal ile basılır (dönüşümlü ebeveynlerden etkilenmez); kapalıyken tıklamayı yutar.
 */

import { useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import type { EmblemSnapshot } from "./Scene";
import { EASE_DOOR, EASE_OUT, play, prefersReducedMotion } from "./motion";
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
  initial?: { geom: EmblemSnapshot; stage: Exclude<DoorStage, "open"> } | null;
  ref?: Ref<DoorHandle>;
};

const noop = () => () => {};

type Geo = { W: number; H: number; cx: number; cy: number; size: number; L1: number; L2: number };

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

  /** Ölçüleri yerleştirir: amblemler, kırpma çokgenleri, ek yeri ve çizgiler. */
  const apply = (g?: EmblemSnapshot) => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = r.width || innerWidth;
    const H = r.height || innerHeight;
    const base = g ?? (geo.current ? { cx: geo.current.cx, cy: geo.current.cy, size: geo.current.size } : { cx: W / 2, cy: H * 0.3, size: 180 });
    const { cx, cy, size } = base;
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
    // Çizgiler amblemin dış halkasından (r = 0.4 * kenar) köşelere.
    const rr = size * 0.4;
    const seg = (tx: number, ty: number) => {
      const dx = tx - cx;
      const dy = ty - cy;
      const d = Math.hypot(dx, dy) || 1;
      const sx = cx + (dx / d) * rr;
      const sy = cy + (dy / d) * rr;
      return { sx, sy, tx, ty, L: Math.max(1, d - rr) };
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
    geo.current = { W, H, cx, cy, size, L1: s1.L, L2: s2.L };
  };

  /** Çizgileri ve uç noktalarını belirli bir orana (0 = gizli, 1 = köşede) yerleştirir. */
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
        { transform: "translate(0,0)", opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: `translate(${t.dataset.dx}px,${t.dataset.dy}px)`, opacity: 1 },
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
        if (root.current) root.current.style.pointerEvents = "";
        apply(g);
        setLines(0);
        if (root.current) root.current.dataset.glow = "";
        setStage("closed");
      },
      async drawLines() {
        if (prefersReducedMotion()) return;
        if (!geo.current) apply();
        setStage("lines");
        await Promise.all(lineAnims(true, 500, EASE_OUT));
        clearAnims();
        setLines(1);
      },
      async split(reveal) {
        const g = geo.current ?? (apply(), geo.current);
        if (!g) return;
        if (prefersReducedMotion()) {
          if (root.current) root.current.style.pointerEvents = "none";
          await play(root.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "linear", fill: "forwards" });
          setStage("open");
          clearAnims();
          return;
        }
        setStage("split");
        // Açılırken panel hemen etkileşime açık: yarılar tıklamayı/dokunmayı yutmaz.
        if (root.current) root.current.style.pointerEvents = "none";
        const opts: KeyframeAnimationOptions = { duration: 800, easing: EASE_DOOR, fill: "forwards" };
        const seam: Keyframe[] = [{ opacity: 0.4 }, { opacity: 1, offset: 0.12 }, { opacity: 0.85, offset: 0.4 }, { opacity: 0 }];
        await Promise.all([
          play(q('[data-f="a"]'), [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${-g.W}px,${-g.H}px,0)` }], opts),
          play(q('[data-f="b"]'), [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${g.W}px,${g.H}px,0)` }], opts),
          ...qa("[data-seam-g]").map((el) => play(el, seam, { duration: 800, easing: "ease-out", fill: "forwards" })),
          reveal
            ? play(
                reveal,
                [
                  { transform: "scale(.955)", opacity: 0.25 },
                  { transform: "scale(1)", opacity: 1 },
                ],
                { duration: 900, easing: EASE_OUT },
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
        if (root.current) root.current.style.pointerEvents = "";
        apply(g);
        if (root.current) delete root.current.dataset.glow;
        const cur = geo.current;
        if (!cur) return;
        if (prefersReducedMotion()) {
          setStage("closed");
          await play(root.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "linear" });
          return;
        }
        setLines(0);
        setStage("split");
        const opts: KeyframeAnimationOptions = { duration: 800, easing: EASE_DOOR, fill: "forwards" };
        const seam: Keyframe[] = [{ opacity: 0 }, { opacity: 0.3, offset: 0.6 }, { opacity: 1, offset: 0.92 }, { opacity: 1 }];
        await Promise.all([
          play(q('[data-f="a"]'), [{ transform: `translate3d(${-cur.W}px,${-cur.H}px,0)` }, { transform: "translate3d(0,0,0)" }], opts),
          play(q('[data-f="b"]'), [{ transform: `translate3d(${cur.W}px,${cur.H}px,0)` }, { transform: "translate3d(0,0,0)" }], opts),
          ...qa("[data-seam-g]").map((el) => play(el, seam, { duration: 800, easing: "linear", fill: "forwards" })),
        ]);
        clearAnims();
        setLines(1);
        setStage("lines");
      },
      async retract() {
        if (prefersReducedMotion()) return;
        if (root.current) root.current.dataset.glow = "";
        await Promise.all(lineAnims(false, 450, "cubic-bezier(.55,0,.75,.2)"));
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
