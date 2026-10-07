import { Card, EmptyState } from "@/components/ui";
import { OperatorLogo } from "@/components/ui/OperatorLogo";
import { TrendChart } from "@/components/raporlar/TrendChart";
import { CountUp } from "@/components/raporlar/CountUp";
import {
  activePreset,
  presetRange,
  parseRange,
  MAX_DAYS,
  type Preset,
} from "@/components/raporlar/range";
import {
  OUTCOME_NAME,
  isEmptyReport,
  normalizeIntake,
  normalizeReport,
  pct,
  ratio,
} from "@/components/raporlar/types";
import s from "@/components/raporlar/raporlar.module.css";
import { toUserMessage } from "@/lib/errors";
import { dayKey, formatDate } from "@/lib/format";
import { canExportReport, canViewTeamReports } from "@/lib/access";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Raporlar" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "today", label: "Bugün" },
  { key: "week", label: "Bu hafta" },
  { key: "month", label: "Bu ay" },
  { key: "lastmonth", label: "Geçen ay" },
];

const day = (k: string) => formatDate(`${k}T12:00:00+03:00`);

/** Oran çubuğu (süs; değer yanındaki metinde). */
function Meter({ rate }: { rate: number }) {
  return (
    <span className={s.meter} aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(1, rate)) * 100}%` }} />
    </span>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  // Raporlar herkese açık. Kapsamı DB belirler: yönetici/view_reports ekip, diğerleri yalnız kendisi.
  const { member } = await getSessionContext();
  const teamAllowed = canViewTeamReports(member);
  const sp = await searchParams;
  // "Ben" görünümü yalnız ekip kapsamı olanlar için anlamlı; diğerleri zaten kendini görür
  const wantSelf = teamAllowed && one(sp.kapsam) === "ben";
  const today = dayKey(new Date());
  const {
    from,
    to,
    error: rangeError,
  } = parseRange(one(sp.from) || undefined, one(sp.to) || undefined, today);
  const preset = activePreset(from, to, today);

  const supabase = await createClient();
  const { data, error } = wantSelf
    ? await supabase.rpc("report_range_member", {
        p_from: from,
        p_to: to,
        p_member: member.id,
      })
    : await supabase.rpc("report_range", { p_from: from, p_to: to });
  const report = error ? null : normalizeReport(data);
  const isTeam = report?.scope === "team";
  // CSV her zaman ekip geneli: yalnız ekip görünümünde ve export + view_reports ile
  const canExport = isTeam && canExportReport(member);
  const scopeQ = wantSelf ? "&kapsam=ben" : "";
  const t = report?.totals;
  // Gelen başvuru özeti yalnız ekip kapsamında (yönetici ya da view_reports)
  const intake = isTeam
    ? normalizeIntake((await supabase.rpc("report_intake", { p_from: from, p_to: to })).data)
    : null;

  // Kaynak ve Operatör tabloları: aranmış müşteriler (rapor) + hiç aranmamış gelenler (özet) birleşir.
  type Row = { key: string; received: number; waiting: number; customers: number; appointments: number; completed: number };
  const mergeRows = (
    base: { key: string; customers: number; appointments: number; completed: number }[],
    extra: { key: string; received: number; waiting: number }[],
  ): Row[] => {
    const m = new Map<string, Row>();
    for (const r of base) m.set(r.key, { ...r, received: 0, waiting: 0 });
    for (const r of extra) {
      const e = m.get(r.key) ?? { key: r.key, received: 0, waiting: 0, customers: 0, appointments: 0, completed: 0 };
      m.set(r.key, { ...e, received: r.received, waiting: r.waiting });
    }
    return [...m.values()].sort((a, b) => b.received - a.received || b.customers - a.customers || a.key.localeCompare(b.key, "tr"));
  };
  const sourceRows = mergeRows(
    (report?.by_source ?? []).map((r) => ({ key: r.source_detail, customers: r.customers, appointments: r.appointments, completed: r.completed })),
    (intake?.by_source ?? []).map((r) => ({ key: r.source_detail, received: r.received, waiting: r.waiting })),
  );
  const operatorRows = mergeRows(
    (report?.by_operator ?? []).map((r) => ({ key: r.operator, customers: r.customers, appointments: 0, completed: r.completed })),
    (intake?.by_operator ?? []).map((r) => ({ key: r.operator, received: r.received, waiting: r.waiting })),
  );
  const showIntake = intake !== null;

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
  const outcomeMax = Math.max(
    1,
    ...(report?.by_outcome.map((o) => o.count) ?? [1]),
  );

  return (
    <>
      <div className="page-head">
        <div className={s.headRow}>
          <div>
            <h1>Raporlar</h1>
            <p>
              {from === to ? day(from) : `${day(from)} - ${day(to)}`}
              {report && !isTeam ? ". Yalnız sizin sonuçlarınız." : null}
            </p>
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

        {teamAllowed ? (
          <nav className={s.bar} aria-label="Rapor kapsamı">
            <a
              className={s.pill}
              href={`/raporlar?from=${from}&to=${to}`}
              aria-current={!wantSelf ? "true" : undefined}
            >
              Ekip
            </a>
            <a
              className={s.pill}
              href={`/raporlar?from=${from}&to=${to}&kapsam=ben`}
              aria-current={wantSelf ? "true" : undefined}
            >
              Ben
            </a>
          </nav>
        ) : null}

        <nav className={s.bar} aria-label="Tarih aralığı">
          {PRESETS.map((p) => {
            const r = presetRange(p.key, today);
            return (
              <a
                key={p.key}
                className={s.pill}
                href={`/raporlar?from=${r.from}&to=${r.to}${scopeQ}`}
                aria-current={preset === p.key ? "true" : undefined}
              >
                {p.label}
              </a>
            );
          })}
        </nav>
        <form
          className={s.custom}
          method="get"
          action="/raporlar"
          aria-label="Özel tarih aralığı"
        >
          {wantSelf ? <input type="hidden" name="kapsam" value="ben" /> : null}
          <label>
            Başlangıç
            <input
              className={`input ${s.dateInput}`}
              type="date"
              name="from"
              defaultValue={from}
              max={today}
              required
            />
          </label>
          <label>
            Bitiş
            <input
              className={`input ${s.dateInput}`}
              type="date"
              name="to"
              defaultValue={to}
              max={today}
              required
            />
          </label>
          <button
            type="submit"
            className={`btn btn-sm ${preset === "custom" ? "btn-ink" : "btn-soft"}`}
          >
            Özel aralığı uygula
          </button>
          <small style={{ color: "var(--ink-3)" }}>
            En fazla {MAX_DAYS} gün.
          </small>
        </form>
      </div>

      {rangeError ? (
        <div className={`form-error ${s.notice}`} role="alert">
          {rangeError}
        </div>
      ) : null}

      {intake ? (
        <Card className={s.intake}>
          <h2>Gelen başvurular</h2>
          <div className={s.intakeGrid}>
            <div>
              <small>Gelen</small>
              <b>
                <CountUp value={intake.received} />
              </b>
              <em>seçilen aralıkta</em>
            </div>
            <div>
              <small>Bakılan</small>
              <b>
                <CountUp value={intake.looked_at} />
              </b>
              <em>en az bir kez arandı</em>
            </div>
            <div>
              <small>Bekleyen</small>
              <b>
                <CountUp value={intake.waiting} />
              </b>
              <em>aralıktakilerden hiç aranmadı</em>
            </div>
            <div>
              <small>Şu an bekleyen</small>
              <b>
                <CountUp value={intake.waiting_now} />
              </b>
              <em>
                {intake.waiting_now_unassigned > 0
                  ? `${intake.waiting_now_unassigned} tanesi kimseye atanmadı`
                  : "tüm zamanlar, hepsi atandı"}
              </em>
            </div>
          </div>
        </Card>
      ) : null}

      {error || !report || !t ? (
        <Card>
          <EmptyState title="Rapor yüklenemedi">
            {toUserMessage(error)} Sayfayı yenileyin; sorun sürerse yöneticinize
            bildirin.
          </EmptyState>
        </Card>
      ) : isEmptyReport(report) ? (
        <Card>
          <EmptyState title="Bu aralıkta kayıt yok">
            Seçtiğiniz günlerde arama veya aşama değişikliği yapılmamış.
            Yukarıdan Bu ay veya Geçen ay aralığını deneyin ya da özel bir tarih
            seçin.
          </EmptyState>
        </Card>
      ) : (
        <div className={s.bento}>
          <div className={`${s.kpi} ${s.kpiHero}`}>
            <small>Randevu</small>
            <b>
              <CountUp value={t.appointments} />
            </b>
            <div>
              <em>{pct(report.rates.appointment_rate)} ulaşılanlardan</em>
              <Meter rate={report.rates.appointment_rate} />
            </div>
          </div>
          <Card className={s.cTrend}>
            <h2>Günlük trend</h2>
            <TrendChart days={report.by_day} from={from} to={to} />
          </Card>

          <div className={`${s.kpi} ${s.kpiA}`}>
            <small>Aranan müşteri</small>
            <b>
              <CountUp value={t.customers_called} />
            </b>
            <em>{t.assigned} atama</em>
          </div>
          <div className={`${s.kpi} ${s.kpiB}`}>
            <small>Deneme</small>
            <b>
              <CountUp value={t.attempts} />
            </b>
            <em>{t.reached} ulaşılan müşteri</em>
          </div>
          <div className={s.kpi}>
            <small>Ulaşma oranı</small>
            <b>
              <CountUp value={report.rates.reach_rate} kind="pct" />
            </b>
            <div>
              <em>
                {t.reached} / {t.customers_called} aranan müşteri
              </em>
              <Meter rate={report.rates.reach_rate} />
            </div>
          </div>
          <div className={s.kpi}>
            <small>Geldi</small>
            <b>
              <CountUp value={t.visited} />
            </b>
            <div>
              <em>{pct(report.rates.visit_rate)} randevudan</em>
              <Meter rate={report.rates.visit_rate} />
            </div>
          </div>
          <div className={`${s.kpi} ${s.kpiLast}`}>
            <small>İşlem tamam</small>
            <b>
              <CountUp value={t.completed} />
            </b>
            <div>
              <em>{pct(report.rates.close_rate)} randevudan</em>
              <Meter rate={report.rates.close_rate} />
            </div>
          </div>
          <Card className={s.cFunnel}>
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
              Randevudan gelene {pct(ratio(t.visited, t.appointments))},
              başvurudan onaya {pct(ratio(t.approved, t.applied))}. Reddedilen{" "}
              {t.rejected}, ilgilenmeyen {t.not_interested}.
            </p>
          </Card>

          <Card className={s.cOutcome}>
            <h2>Arama sonuçları</h2>
            {report.by_outcome.length === 0 ? (
              <p className={s.sub}>Bu aralıkta arama yok.</p>
            ) : (
              <div className={s.outcomes}>
                {report.by_outcome.map((o) => (
                  <div className={s.outcomeRow} key={o.outcome}>
                    <span>{OUTCOME_NAME[o.outcome] ?? o.outcome}</span>
                    <div className={s.track} aria-hidden="true">
                      <i style={{ width: `${(o.count / outcomeMax) * 100}%` }} />
                    </div>
                    <b>{o.count}</b>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {isTeam ? (
            <Card className={s.cTeam}>
              <h2>Çalışanlar</h2>
              <div className={s.scrollx}>
                <table className={s.table}>
                  <caption className={s.srOnly}>
                    Çalışan bazında arama sonuçları
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Çalışan</th>
                      <th scope="col" className={s.num}>
                        Deneme
                      </th>
                      <th scope="col" className={s.num}>
                        Ulaşılan müşteri
                      </th>
                      <th scope="col" className={s.num}>
                        Ulaşma
                      </th>
                      <th scope="col" className={s.num}>
                        Randevu
                      </th>
                      <th scope="col" className={s.num}>
                        İşlem tamam
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_member.map((m) => (
                      <tr key={m.member_id}>
                        <th scope="row">{m.full_name}</th>
                        <td className={s.num}>{m.attempts}</td>
                        <td className={s.num}>{m.reached}</td>
                        <td className={s.num}>
                          {pct(ratio(m.reached, m.customers_called))}
                        </td>
                        <td className={s.num}>{m.appointments}</td>
                        <td className={s.num}>{m.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card className={s.cSource}>
            <h2>Kaynak performansı</h2>
            <div className={s.scrollx}>
              <table className={s.table}>
                <caption className={s.srOnly}>
                  Reklam ve form kaynağına göre müşteriler
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Kaynak</th>
                    {showIntake ? (
                      <>
                        <th scope="col" className={s.num}>
                          Gelen
                        </th>
                        <th scope="col" className={s.num}>
                          Bekleyen
                        </th>
                      </>
                    ) : null}
                    <th scope="col" className={s.num}>
                      Aranan
                    </th>
                    <th scope="col" className={s.num}>
                      Randevu
                    </th>
                    <th scope="col" className={s.num}>
                      Tamam
                    </th>
                    <th scope="col" className={s.num}>
                      Dönüşüm
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.length === 0 ? (
                    <tr>
                      <td colSpan={showIntake ? 7 : 5}>Kayıt yok.</td>
                    </tr>
                  ) : (
                    sourceRows.map((r) => (
                      <tr key={r.key}>
                        <th scope="row">{r.key}</th>
                        {showIntake ? (
                          <>
                            <td className={s.num}>{r.received}</td>
                            <td className={s.num}>{r.waiting}</td>
                          </>
                        ) : null}
                        <td className={s.num}>{r.customers}</td>
                        <td className={s.num}>{r.appointments}</td>
                        <td className={s.num}>{r.completed}</td>
                        <td className={s.num}>
                          {pct(ratio(r.completed, r.customers))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className={s.cOperator}>
            <h2>Operatör</h2>
            <div className={s.scrollx}>
              <table className={s.table}>
                <caption className={s.srOnly}>
                  Operatöre göre müşteriler
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Operatör</th>
                    {showIntake ? (
                      <>
                        <th scope="col" className={s.num}>
                          Gelen
                        </th>
                        <th scope="col" className={s.num}>
                          Bekleyen
                        </th>
                      </>
                    ) : null}
                    <th scope="col" className={s.num}>
                      Aranan
                    </th>
                    <th scope="col" className={s.num}>
                      Tamam
                    </th>
                    <th scope="col" className={s.num}>
                      Dönüşüm
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {operatorRows.length === 0 ? (
                    <tr>
                      <td colSpan={showIntake ? 6 : 4}>Kayıt yok.</td>
                    </tr>
                  ) : (
                    operatorRows.map((r) => (
                      <tr key={r.key}>
                        <th scope="row">
                          <OperatorLogo operator={r.key} />
                        </th>
                        {showIntake ? (
                          <>
                            <td className={s.num}>{r.received}</td>
                            <td className={s.num}>{r.waiting}</td>
                          </>
                        ) : null}
                        <td className={s.num}>{r.customers}</td>
                        <td className={s.num}>{r.completed}</td>
                        <td className={s.num}>
                          {pct(ratio(r.completed, r.customers))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
