import { Card, EmptyState } from "@/components/ui";
import { TrendChart } from "@/components/raporlar/TrendChart";
import { activePreset, presetRange, parseRange, MAX_DAYS, type Preset } from "@/components/raporlar/range";
import { OPERATOR_NAME, OUTCOME_NAME, isEmptyReport, normalizeReport, pct, ratio } from "@/components/raporlar/types";
import s from "@/components/raporlar/raporlar.module.css";
import { toUserMessage } from "@/lib/errors";
import { dayKey, formatDate } from "@/lib/format";
import { can, requireAccess } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Raporlar" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "today", label: "Bugün" },
  { key: "week", label: "Bu hafta" },
  { key: "month", label: "Bu ay" },
  { key: "lastmonth", label: "Geçen ay" },
];

const day = (k: string) => formatDate(`${k}T12:00:00+03:00`);

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const { member } = await requireAccess(({ member }) => member.role === "manager" || can(member, "view_reports"));
  const sp = await searchParams;
  const today = dayKey(new Date());
  const { from, to, error: rangeError } = parseRange(one(sp.from) || undefined, one(sp.to) || undefined, today);
  const preset = activePreset(from, to, today);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_range", { p_from: from, p_to: to });
  const report = error ? null : normalizeReport(data);
  const canExport = member.role === "manager" || can(member, "export");
  const t = report?.totals;

  const funnel: [string, string, number][] = t
    ? [
        ["Randevu", "Dükkana gelecek", t.appointments],
        ["Geldi", "Dükkana gelen", t.visited],
        ["Başvuru", "Başvuru alınan", t.applied],
        ["Onay", "Onaylanan", t.approved],
        ["Tamam", "İşlemi biten", t.completed],
      ]
    : [];
  const funnelMax = Math.max(1, ...funnel.map((f) => f[2]));
  const outcomeMax = Math.max(1, ...(report?.by_outcome.map((o) => o.count) ?? [1]));

  return (
    <>
      <div className="page-head">
        <div className={s.headRow}>
          <div>
            <h1>Raporlar</h1>
            <p>{from === to ? day(from) : `${day(from)} - ${day(to)}`}</p>
          </div>
          {canExport ? (
            <a
              className="btn btn-soft"
              href={`/api/export/report?from=${from}&to=${to}`}
              download
            >
              Raporu indir (CSV)
            </a>
          ) : null}
        </div>

        <nav className={s.bar} aria-label="Tarih aralığı">
          {PRESETS.map((p) => {
            const r = presetRange(p.key, today);
            return (
              <a
                key={p.key}
                className={s.pill}
                href={`/raporlar?from=${r.from}&to=${r.to}`}
                aria-current={preset === p.key ? "true" : undefined}
              >
                {p.label}
              </a>
            );
          })}
        </nav>
        <form className={s.custom} method="get" action="/raporlar" aria-label="Özel tarih aralığı">
          <label>
            Başlangıç
            <input className={`input ${s.dateInput}`} type="date" name="from" defaultValue={from} max={today} required />
          </label>
          <label>
            Bitiş
            <input className={`input ${s.dateInput}`} type="date" name="to" defaultValue={to} max={today} required />
          </label>
          <button type="submit" className={`btn btn-sm ${preset === "custom" ? "btn-ink" : "btn-soft"}`}>
            Özel aralığı uygula
          </button>
          <small style={{ color: "var(--ink-3)" }}>En fazla {MAX_DAYS} gün.</small>
        </form>
      </div>

      {rangeError ? (
        <div className={`form-error ${s.notice}`} role="alert">
          {rangeError}
        </div>
      ) : null}

      {error || !report || !t ? (
        <Card>
          <EmptyState title="Rapor yüklenemedi">{toUserMessage(error)} Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.</EmptyState>
        </Card>
      ) : isEmptyReport(report) ? (
        <Card>
          <EmptyState title="Bu aralıkta kayıt yok">
            Seçtiğiniz günlerde arama veya aşama değişikliği yapılmamış. Yukarıdan Bu ay veya Geçen ay aralığını deneyin ya da özel bir
            tarih seçin.
          </EmptyState>
        </Card>
      ) : (
        <div className={s.stack}>
          <div className={s.kpis} role="group" aria-label="Özet göstergeler">
            <div className={s.kpi}>
              <small>Aranan müşteri</small>
              <b>{t.customers_called}</b>
            </div>
            <div className={s.kpi}>
              <small>Deneme</small>
              <b>{t.attempts}</b>
            </div>
            <div className={s.kpi}>
              <small>Ulaşma oranı</small>
              <b>{pct(report.rates.reach_rate)}</b>
              <em>
                {t.reached} / {t.attempts} deneme
              </em>
            </div>
            <div className={`${s.kpi} ${s.kpiBrand}`}>
              <small>Randevu</small>
              <b>{t.appointments}</b>
              <em>{pct(report.rates.appointment_rate)} ulaşılanlardan</em>
            </div>
            <div className={s.kpi}>
              <small>Geldi</small>
              <b>{t.visited}</b>
              <em>{pct(report.rates.visit_rate)} randevudan</em>
            </div>
            <div className={s.kpi}>
              <small>İşlem tamam</small>
              <b>{t.completed}</b>
              <em>{pct(report.rates.close_rate)} randevudan</em>
            </div>
          </div>

          <Card>
            <h2>Günlük trend</h2>
            <TrendChart days={report.by_day} />
          </Card>

          <div className={s.two}>
            <Card>
              <h2>Huni</h2>
              <div className={s.funnel}>
                {funnel.map(([label, sub, val]) => (
                  <div className={s.f} key={label}>
                    <div>
                      {label}
                      <small>{sub}</small>
                    </div>
                    <div className={s.track} aria-hidden="true">
                      <i style={{ width: `${(val / funnelMax) * 100}%` }} />
                    </div>
                    <b>{val}</b>
                  </div>
                ))}
              </div>
              <p className={s.sub}>
                Randevudan gelene {pct(ratio(t.visited, t.appointments))}, başvurudan onaya {pct(ratio(t.approved, t.applied))}. Reddedilen{" "}
                {t.rejected}, ilgilenmeyen {t.not_interested}.
              </p>
            </Card>

            <Card>
              <h2>Arama sonuçları</h2>
              {report.by_outcome.length === 0 ? (
                <p className={s.sub}>Bu aralıkta arama yok.</p>
              ) : (
                report.by_outcome.map((o) => (
                  <div className={s.outcomeRow} key={o.outcome}>
                    <span>{OUTCOME_NAME[o.outcome] ?? o.outcome}</span>
                    <div className={s.track} aria-hidden="true">
                      <i style={{ width: `${(o.count / outcomeMax) * 100}%` }} />
                    </div>
                    <b>{o.count}</b>
                  </div>
                ))
              )}
            </Card>
          </div>

          <Card>
            <h2>Çalışanlar</h2>
            <div className={s.scrollx}>
              <table className={s.table}>
                <caption className={s.srOnly}>Çalışan bazında arama sonuçları</caption>
                <thead>
                  <tr>
                    <th scope="col">Çalışan</th>
                    <th scope="col" className={s.num}>Deneme</th>
                    <th scope="col" className={s.num}>Ulaşılan</th>
                    <th scope="col" className={s.num}>Ulaşma</th>
                    <th scope="col" className={s.num}>Randevu</th>
                    <th scope="col" className={s.num}>İşlem tamam</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_member.map((m) => (
                    <tr key={m.member_id}>
                      <th scope="row">{m.full_name}</th>
                      <td className={s.num}>{m.attempts}</td>
                      <td className={s.num}>{m.reached}</td>
                      <td className={s.num}>{pct(ratio(m.reached, m.attempts))}</td>
                      <td className={s.num}>{m.appointments}</td>
                      <td className={s.num}>{m.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className={s.two}>
            <Card>
              <h2>Kaynak performansı</h2>
              <div className={s.scrollx}>
                <table className={s.table}>
                  <caption className={s.srOnly}>Reklam ve form kaynağına göre müşteriler</caption>
                  <thead>
                    <tr>
                      <th scope="col">Kaynak</th>
                      <th scope="col" className={s.num}>Müşteri</th>
                      <th scope="col" className={s.num}>Randevu</th>
                      <th scope="col" className={s.num}>Tamam</th>
                      <th scope="col" className={s.num}>Dönüşüm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_source.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Kayıt yok.</td>
                      </tr>
                    ) : (
                      report.by_source.map((r) => (
                        <tr key={r.source_detail}>
                          <th scope="row">{r.source_detail}</th>
                          <td className={s.num}>{r.customers}</td>
                          <td className={s.num}>{r.appointments}</td>
                          <td className={s.num}>{r.completed}</td>
                          <td className={s.num}>{pct(ratio(r.completed, r.customers))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <h2>Operatör</h2>
              <div className={s.scrollx}>
                <table className={s.table}>
                  <caption className={s.srOnly}>Operatöre göre müşteriler</caption>
                  <thead>
                    <tr>
                      <th scope="col">Operatör</th>
                      <th scope="col" className={s.num}>Müşteri</th>
                      <th scope="col" className={s.num}>Tamam</th>
                      <th scope="col" className={s.num}>Dönüşüm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_operator.length === 0 ? (
                      <tr>
                        <td colSpan={4}>Kayıt yok.</td>
                      </tr>
                    ) : (
                      report.by_operator.map((r) => (
                        <tr key={r.operator}>
                          <th scope="row">{OPERATOR_NAME[r.operator] ?? r.operator}</th>
                          <td className={s.num}>{r.customers}</td>
                          <td className={s.num}>{r.completed}</td>
                          <td className={s.num}>{pct(ratio(r.completed, r.customers))}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
