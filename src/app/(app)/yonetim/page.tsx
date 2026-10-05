import { Card, EmptyState } from "@/components/ui";
import { DateBar } from "@/components/yonetim/DateBar";
import { TeamList, type TeamRow } from "@/components/yonetim/TeamList";
import { OUTCOME_LABEL, STAGE_LABEL, firstName, shortName } from "@/components/yonetim/labels";
import s from "@/components/yonetim/yonetim.module.css";
import { dayKey, formatTime, formatWeekday } from "@/lib/format";
import { canViewTeam } from "@/lib/access";
import { loadErrorText } from "@/lib/errors";
import { requireAccess } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Yönetim" };

type FeedItem = { id: string; at: string; who: string; customer: string; what: string; customerId: string; memberId: string };

function parseDay(raw: string | undefined, today: string): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return today;
  const t = new Date(`${raw}T00:00:00+03:00`);
  if (Number.isNaN(t.getTime()) || dayKey(t) !== raw || raw > today) return today;
  return raw;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const ctx = await requireAccess(({ member }) => canViewTeam(member));
  const isManager = ctx.member.role === "manager";
  const sp = await searchParams;
  const today = dayKey(new Date());
  const day = parseDay(sp.gun, today);
  const start = new Date(`${day}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);

  const supabase = await createClient();
  const [summaryRes, membersRes, attemptsRes, eventsRes] = await Promise.all([
    supabase.rpc("day_summary", { p_day: day }),
    supabase.from("members").select("id, full_name, absent_on"),
    supabase
      .from("call_attempts")
      .select("id, created_at, customer_id, member_id, outcome")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("pipeline_events")
      .select("id, created_at, customer_id, member_id, stage")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (summaryRes.error) console.error("[yonetim] özet okunamadı:", summaryRes.error.code ?? summaryRes.error.message);
  const loadError = summaryRes.error ? loadErrorText(summaryRes.error) : null;
  const members = new Map((membersRes.data ?? []).map((m) => [m.id, m]));
  const summary = summaryRes.data ?? [];

  const rows: TeamRow[] = summary.map((r) => ({
    ...r,
    absent: members.get(r.member_id)?.absent_on === day,
  }));

  const totals = summary.reduce(
    (a, r) => ({
      assigned: a.assigned + r.assigned,
      done: a.done + r.done,
      reached: a.reached + r.reached,
      appointments: a.appointments + r.appointments,
      retries: a.retries + r.retries,
    }),
    { assigned: 0, done: 0, reached: 0, appointments: 0, retries: 0 },
  );

  // Son işlemler: arama sonuçları + aşama olayları. log_call'ın yazdığı aynı anlık aşama olayı tekrar gösterilmez.
  const attempts = attemptsRes.data ?? [];
  const events = (eventsRes.data ?? []).filter((e) => {
    const et = new Date(e.created_at ?? 0).getTime();
    return !attempts.some(
      (a) =>
        a.customer_id === e.customer_id &&
        a.member_id === e.member_id &&
        Math.abs(new Date(a.created_at ?? 0).getTime() - et) < 3000,
    );
  });
  const customerIds = [...new Set([...attempts.map((a) => a.customer_id), ...events.map((e) => e.customer_id)])];
  const custRes = customerIds.length
    ? await supabase.from("customers").select("id, full_name").in("id", customerIds)
    : { data: [] as { id: string; full_name: string }[] };
  const customers = new Map((custRes.data ?? []).map((c) => [c.id, c.full_name]));

  const feed: FeedItem[] = [
    ...attempts.map((a) => ({
      id: `a-${a.id}`,
      at: a.created_at ?? "",
      memberId: a.member_id,
      customerId: a.customer_id,
      who: firstName(members.get(a.member_id)?.full_name),
      customer: shortName(customers.get(a.customer_id)),
      what: OUTCOME_LABEL[a.outcome] ?? a.outcome,
    })),
    ...events.map((e) => ({
      id: `e-${e.id}`,
      at: e.created_at ?? "",
      memberId: e.member_id,
      customerId: e.customer_id,
      who: firstName(members.get(e.member_id)?.full_name),
      customer: shortName(customers.get(e.customer_id)),
      what: `Aşama: ${STAGE_LABEL[e.stage] ?? e.stage}`,
    })),
  ]
    .sort((x, y) => (x.at < y.at ? 1 : -1))
    .slice(0, 30);

  const maxVal = Math.max(1, totals.assigned, totals.done, totals.reached, totals.appointments);
  const steps: [string, string, number][] = [
    ["Atanan", "Güne verilen", totals.assigned],
    ["Tamamlanan", "İşi biten", totals.done],
    ["Ulaşılan", "Konuşulan", totals.reached],
    ["Randevu", "Dükkana gelecek", totals.appointments],
  ];

  return (
    <>
      <div className="page-head">
        <h1>Yönetim</h1>
        <p>{day === today ? `Bugün, ${formatWeekday(start)}` : formatWeekday(start)}</p>
        <DateBar day={day} today={today} />
      </div>

      {loadError ? (
        <Card>
          <EmptyState title="Özet yüklenemedi">{loadError}</EmptyState>
        </Card>
      ) : (
        <>
          <div className={s.kpis} aria-label="Günün özeti">
            <div className={s.kpi}>
              <small>Atanan</small>
              <b>{totals.assigned}</b>
            </div>
            <div className={s.kpi}>
              <small>Tamamlanan</small>
              <b>{totals.done}</b>
            </div>
            <div className={s.kpi}>
              <small>Ulaşılan</small>
              <b>{totals.reached}</b>
            </div>
            <div className={`${s.kpi} ${s.kpiBrand}`}>
              <small>Randevu</small>
              <b>{totals.appointments}</b>
            </div>
            <div className={s.kpi}>
              <small>Tekrar</small>
              <b>{totals.retries}</b>
            </div>
          </div>

          <div className={s.grid}>
            <div className={s.stack}>
              <Card>
                <h2>Günün hunisi</h2>
                <div className={s.funnel}>
                  {steps.map(([label, sub, val]) => (
                    <div className={s.f} key={label}>
                      <div>
                        {label}
                        <small>{sub}</small>
                      </div>
                      <div className={s.track}>
                        <i style={{ width: `${(val / maxVal) * 100}%` }} />
                      </div>
                      <b>{val}</b>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <h2>Ekip</h2>
                <TeamList rows={rows} day={day} canMarkAbsent={isManager && day >= today} />
              </Card>
            </div>

            <Card>
              <h2>Son işlemler</h2>
              {feed.length === 0 ? (
                <EmptyState title="Bu gün işlem yok">Çalışanlar arama sonucu girdikçe burada akar.</EmptyState>
              ) : (
                <div className={s.feed}>
                  {feed.map((f) => (
                    <div className={s.row} key={f.id}>
                      <div style={{ minWidth: 0 }}>
                        <b>
                          {f.who} → {f.customer}
                        </b>
                        <span>{f.what}</span>
                      </div>
                      <time dateTime={f.at}>{formatTime(f.at)}</time>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
