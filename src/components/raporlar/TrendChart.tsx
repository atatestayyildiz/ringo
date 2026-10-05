"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Report } from "./types";
import s from "./raporlar.module.css";

type Day = Report["by_day"][number];
type Key = "attempts" | "reached" | "appointments";

const SERIES: { key: Key; label: string; cls: string; line: string; area: number; width: number }[] = [
  { key: "attempts", label: "Arama", cls: "Attempts", line: "var(--ink)", area: 0.12, width: 2 },
  { key: "reached", label: "Ulaşılan", cls: "Reached", line: "var(--c-wait)", area: 0.16, width: 2 },
  { key: "appointments", label: "Randevu", cls: "Appt", line: "var(--brand)", area: 0.26, width: 2.5 },
];

const DEFAULT_W = 640;
const DEFAULT_H = 280;
const MAX_FILL_DAYS = 400;

const parseDay = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, 12);
};
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDay = (k: string) =>
  new Date(parseDay(k)).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = (k: string) =>
  new Date(parseDay(k)).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Aralığı gün gün doldurur; verisi olmayan gün 0 sayılır (çizgi boşlukları yanıltmasın). */
function fillDays(days: Day[], from?: string, to?: string): Day[] {
  const byKey = new Map(days.map((d) => [d.day, d]));
  const a = from ?? days[0]?.day;
  const b = to ?? days[days.length - 1]?.day;
  if (!a || !b) return days;
  const t0 = parseDay(a);
  const t1 = parseDay(b);
  const n = Math.round((t1 - t0) / 86400000) + 1;
  if (!(n >= 1) || n > MAX_FILL_DAYS) return days;
  return Array.from({ length: n }, (_, i) => {
    const k = dayStr(t0 + i * 86400000);
    return byKey.get(k) ?? { day: k, attempts: 0, reached: 0, appointments: 0 };
  });
}

/** Yuvarlak adımlı eksen: tam sayı adım (1, 2, 5, 10, 20...), ~4 aralık. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = Math.max(1, max / 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

const nf = (n: number) => n.toLocaleString("tr-TR");

/** Günlük trend: üç çizgi (arama, ulaşılan, randevu) + hafif alan dolgusu. Kütüphanesiz SVG. */
export function TrendChart({ days, from, to }: { days: Day[]; from?: string; to?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const data = useMemo(() => fillDays(days, from, to), [days, from, to]);
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const small = w < 480;
  const M = { l: small ? 34 : 42, r: small ? 12 : 16, t: 14, b: 30 };
  const pad = small ? 14 : 22;
  const x0 = M.l + pad;
  const x1 = w - M.r - pad;
  const plotH = Math.max(40, h - M.t - M.b);
  const n = data.length;

  const rawMax = Math.max(0, ...data.flatMap((d) => [d.attempts, d.reached, d.appointments]));
  const { top, ticks } = niceScale(rawMax);
  const hasData = rawMax > 0;
  const total = data.reduce((acc, d) => acc + d.attempts, 0);
  const totals: Record<Key, number> = {
    attempts: total,
    reached: data.reduce((a, d) => a + d.reached, 0),
    appointments: data.reduce((a, d) => a + d.appointments, 0),
  };

  const X = useCallback((i: number) => (n <= 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (n - 1)), [n, x0, x1]);
  const Y = (v: number) => M.t + plotH - (v / top) * plotH;
  const base = M.t + plotH;

  const stepPx = n > 1 ? (x1 - x0) / (n - 1) : x1 - x0;
  const labelEvery = Math.max(1, Math.ceil((small ? 70 : 60) / Math.max(1, stepPx)));
  const showDots = n <= 16;

  const pathOf = (k: Key) => data.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(d[k]).toFixed(1)}`).join("");
  const areaOf = (k: Key) => `${pathOf(k)}L${X(n - 1).toFixed(1)} ${base}L${X(0).toFixed(1)} ${base}Z`;

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    if (n <= 1) return setActive(0);
    const i = Math.round(((px - x0) / (x1 - x0)) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const cur = active ?? (e.key === "ArrowLeft" ? n : -1);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };

  const a = active !== null ? data[active] : null;
  const ax = active !== null ? X(active) : 0;
  const flip = ax > w * 0.55;

  return (
    <div className={s.trendWrap}>
      <ul className={s.legend}>
        {SERIES.map((sr) => (
          <li key={sr.key}>
            <i className={s[`dot${sr.cls}`]} />
            {sr.label}
            <b>{nf(totals[sr.key])}</b>
          </li>
        ))}
      </ul>

      <div
        className={s.plot}
        ref={plotRef}
        tabIndex={0}
        role="group"
        aria-label="Günlük arama trendi grafiği. Günleri gezmek için sol ve sağ ok tuşlarını kullanın."
        onKeyDown={onKey}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setActive((p) => p ?? (n ? n - 1 : null));
        }}
        onBlur={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${w} ${h}`} className={s.trend} aria-hidden="true" focusable="false">
          <defs>
            {SERIES.map((sr) => (
              <linearGradient key={sr.key} id={`${uid}${sr.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: sr.line, stopOpacity: sr.area }} />
                <stop offset="1" style={{ stopColor: sr.line, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={w - M.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? s.axis : s.grid} />
              <text x={M.l - 8} y={Y(v)} textAnchor="end" dominantBaseline="central" className={s.tick}>
                {nf(v)}
              </text>
            </g>
          ))}

          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <g key={d.day}>
                <line x1={X(i)} x2={X(i)} y1={base} y2={base + 4} className={s.axis} />
                <text x={X(i)} y={base + 18} textAnchor="middle" className={s.tick}>
                  {shortDay(d.day)}
                </text>
              </g>
            ) : null,
          )}

          {hasData && n > 1
            ? [...SERIES].map((sr) => <path key={sr.key} d={areaOf(sr.key)} fill={`url(#${uid}${sr.key})`} className={s.area} />)
            : null}

          {hasData && n > 1
            ? SERIES.map((sr) => (
                <path
                  key={sr.key}
                  d={pathOf(sr.key)}
                  pathLength={1}
                  fill="none"
                  stroke={sr.line}
                  strokeWidth={sr.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={s.line}
                />
              ))
            : null}

          {hasData && (showDots || n === 1)
            ? SERIES.map((sr) =>
                data.map((d, i) => (
                  <circle key={`${sr.key}${d.day}`} cx={X(i)} cy={Y(d[sr.key])} r={n === 1 ? 5 : 3.5} fill={sr.line} className={s.dot} />
                )),
              )
            : null}

          {!hasData ? (
            <text x={(M.l + w - M.r) / 2} y={M.t + plotH / 2 - 6} textAnchor="middle" className={s.emptyText}>
              Bu aralıkta arama yok
            </text>
          ) : null}

          {a ? (
            <g pointerEvents="none">
              <line x1={ax} x2={ax} y1={M.t} y2={base} className={s.cross} />
              {SERIES.map((sr) => (
                <circle key={sr.key} cx={ax} cy={Y(a[sr.key])} r={5.5} fill={sr.line} className={s.dotActive} />
              ))}
            </g>
          ) : null}

          <rect
            x={M.l}
            y={0}
            width={Math.max(0, w - M.l - M.r)}
            height={h}
            fill="transparent"
            className={s.hit}
            onPointerDown={pick}
            onPointerMove={pick}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setActive(null);
            }}
          />
        </svg>

        {a ? (
          <div
            className={s.tip}
            style={{ left: ax, transform: `translateX(${flip ? "calc(-100% - 14px)" : "14px"})` }}
            role="presentation"
          >
            <strong>{longDay(a.day)}</strong>
            {SERIES.map((sr) => (
              <span key={sr.key}>
                <i className={s[`dot${sr.cls}`]} />
                {sr.label}
                <b>{nf(a[sr.key])}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className={s.srOnly} aria-live="polite">
        {a
          ? `${longDay(a.day)}: ${a.attempts} arama, ${a.reached} ulaşılan, ${a.appointments} randevu.`
          : `${n} günde toplam ${total} arama. Ayrıntılı değerler altındaki tabloda.`}
      </p>

      <details className={s.alt}>
        <summary>Tablo olarak göster</summary>
        <div className={s.scrollx}>
          <table className={s.table}>
            <caption className={s.srOnly}>Günlük arama sayıları</caption>
            <thead>
              <tr>
                <th scope="col">Gün</th>
                <th scope="col" className={s.num}>
                  Arama
                </th>
                <th scope="col" className={s.num}>
                  Ulaşılan
                </th>
                <th scope="col" className={s.num}>
                  Randevu
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{shortDay(d.day)}</th>
                  <td className={s.num}>{d.attempts}</td>
                  <td className={s.num}>{d.reached}</td>
                  <td className={s.num}>{d.appointments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
