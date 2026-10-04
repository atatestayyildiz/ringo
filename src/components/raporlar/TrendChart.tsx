import { formatDayMonth } from "@/lib/format";
import type { Report } from "./types";
import s from "./raporlar.module.css";

const H = 160;
const PAD_T = 8;
const PAD_B = 22;
const BAR = 7;
const GAP = 2;
const SLOT = BAR * 3 + GAP * 2 + 12;

/** Günlük trend: gün başına üç hap çubuk (arama, ulaşılan, randevu). Kütüphanesiz SVG. */
export function TrendChart({ days }: { days: Report["by_day"] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.attempts, d.reached, d.appointments]));
  const width = Math.max(days.length * SLOT, 320);
  const plotH = H - PAD_T - PAD_B;
  const labelEvery = Math.max(1, Math.ceil(days.length / 12));
  const total = days.reduce((a, d) => a + d.attempts, 0);

  const bar = (x: number, v: number, cls: string) => {
    const h = v > 0 ? Math.max(BAR, (v / max) * plotH) : 0;
    if (!h) return null;
    return <rect x={x} y={PAD_T + plotH - h} width={BAR} height={h} rx={BAR / 2} className={cls} />;
  };

  return (
    <div>
      <ul className={s.legend} aria-hidden="true">
        <li>
          <i className={s.dotAttempts} /> Arama
        </li>
        <li>
          <i className={s.dotReached} /> Ulaşılan
        </li>
        <li>
          <i className={s.dotAppt} /> Randevu
        </li>
      </ul>
      <div className={s.scrollx}>
        <svg
          viewBox={`0 0 ${width} ${H}`}
          style={{ minWidth: width }}
          role="img"
          aria-labelledby="trend-title trend-desc"
          className={s.trend}
        >
          <title id="trend-title">Günlük arama trendi</title>
          <desc id="trend-desc">
            {days.length} günde toplam {total} arama. Her gün için arama, ulaşılan ve randevu sayısı çubuk olarak gösterilir. Ayrıntılı
            değerler altındaki tabloda.
          </desc>
          <line x1="0" x2={width} y1={PAD_T + plotH} y2={PAD_T + plotH} className={s.axis} />
          {days.map((d, i) => {
            const x0 = i * SLOT + 6;
            return (
              <g key={d.day}>
                <title>{`${formatDayMonth(`${d.day}T12:00:00+03:00`)}: ${d.attempts} arama, ${d.reached} ulaşılan, ${d.appointments} randevu`}</title>
                {bar(x0, d.attempts, s.barAttempts)}
                {bar(x0 + BAR + GAP, d.reached, s.barReached)}
                {bar(x0 + 2 * (BAR + GAP), d.appointments, s.barAppt)}
                {i % labelEvery === 0 ? (
                  <text x={x0 + (BAR * 3 + GAP * 2) / 2} y={H - 6} textAnchor="middle" className={s.tick}>
                    {d.day.slice(8, 10)}.{d.day.slice(5, 7)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
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
                  <th scope="row">{formatDayMonth(`${d.day}T12:00:00+03:00`)}</th>
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
