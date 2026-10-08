import { BugunView } from "@/components/bugun/BugunView";
import {
  firstName,
  type BirthdayInfo,
  type ClaimInfo,
  type DistributionMode,
  type Item,
  type PoolInfo,
  type TeamRow,
} from "@/components/bugun/model";
import type { CallStatus } from "@/components/ui";
import type { MemberLite, Viewer } from "@/components/musteri/shared";
import { can } from "@/lib/access";
import { dayDiff, dayKey, formatDayMonth, formatWeekday, relativeTime, waLink } from "@/lib/format";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bugün" };
export const dynamic = "force-dynamic";

function greeting(now: Date): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Istanbul" }).format(now),
  );
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 18) return "İyi günler";
  return "İyi akşamlar";
}

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m: focusParam } = await searchParams;
  const { member, settings } = await getSessionContext();
  const supabase = await createClient();
  const now = new Date();
  const today = dayKey(now);
  const isManager = member.role === "manager";

  // Atamalar: kendi listesi; yönetici kendi listesi boşsa ekip görünümü
  let teamView = false;
  let { data: assignments } = await supabase
    .from("daily_assignments")
    .select("customer_id, member_id, position")
    .eq("day", today)
    .eq("member_id", member.id)
    .order("position");
  if (isManager && !assignments?.length) {
    teamView = true;
    ({ data: assignments } = await supabase
      .from("daily_assignments")
      .select("customer_id, member_id, position")
      .eq("day", today)
      .order("member_id")
      .order("position"));
  }
  const rows = assignments ?? [];
  const ids = rows.map((r) => r.customer_id);

  const weekIso = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const mode: DistributionMode =
    settings.distribution_mode === "free_pool" || settings.distribution_mode === "manual"
      ? settings.distribution_mode
      : "auto_even";

  const [customersRes, attemptsRes, birthdaysRes, rulesRes, poolRes, summaryRes, membersRes, claimRes] = await Promise.all([
    ids.length
      ? supabase
          .from("customers")
          .select(
            "id, full_name, phone, phone_alt, operator, amount, applied_at, call_status, attempts_in_round, next_call_at",
          )
          .in("id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("call_attempts")
          .select("customer_id, outcome, note, created_at")
          .in("customer_id", ids)
          .order("created_at", { ascending: false })
          .limit(600)
      : Promise.resolve({ data: [] }),
    supabase.rpc("upcoming_birthdays"),
    supabase.rpc("rules_summary_text"),
    // Ortak havuz: kiracının tüm havuzu (Havuz sayfasıyla aynı kaynak, telefon yok)
    supabase.rpc("list_pool"),
    isManager ? supabase.rpc("day_summary", { p_day: today }) : Promise.resolve({ data: null }),
    supabase.from("members").select("id, full_name, is_active"),
    mode === "free_pool" ? supabase.rpc("claim_queue_status") : Promise.resolve({ data: null }),
  ]);

  const byId = new Map((customersRes.data ?? []).map((c) => [c.id, c]));
  const logs = new Map<string, { outcome: string; note: string | null }[]>();
  for (const a of attemptsRes.data ?? []) {
    const l = logs.get(a.customer_id) ?? [];
    if (l.length < 3) l.push({ outcome: a.outcome, note: a.note });
    logs.set(a.customer_id, l);
  }
  const names = new Map((membersRes.data ?? []).map((m) => [m.id, m.full_name]));

  const items: Item[] = [];
  for (const r of rows) {
    const c = byId.get(r.customer_id);
    if (!c) continue;
    items.push({
      id: c.id,
      name: c.full_name,
      phone: c.phone,
      operator: c.operator,
      phoneAlt: c.phone_alt,
      amount: c.amount,
      appliedLabel: c.applied_at ? relativeTime(c.applied_at, now) : null,
      status: c.call_status as CallStatus,
      tries: c.attempts_in_round,
      nextCallAt: c.next_call_at,
      position: r.position,
      owner: teamView ? (names.get(r.member_id) ?? null) : null,
      log: (logs.get(c.id) ?? []).slice().reverse(),
    });
  }

  // Doğum günü
  const bdays = birthdaysRes.data ?? [];
  let birthday: BirthdayInfo | null = null;
  if (bdays.length) {
    const b = bdays[0];
    const { data: bc } = await supabase.from("customers").select("phone").eq("id", b.customer_id).maybeSingle();
    birthday = {
      name: b.full_name,
      daysLeft: b.days_left,
      dateLabel: formatDayMonth(b.birth_date),
      waHref: waLink(bc?.phone),
      more: bdays.length - 1,
    };
  }

  // Havuz
  const poolDates = (poolRes.data ?? []).map((p) => p.next_call_at);
  const pool: PoolInfo = {
    count: poolDates.length,
    nearestDays: poolDates.length ? Math.max(0, dayDiff(poolDates[0], now)) : null,
    thisWeek: poolDates.filter((d) => d <= weekIso).length,
  };

  const cq = claimRes.data?.[0];
  const claim: ClaimInfo | null = cq ? { waiting: cq.waiting, open: cq.open_count, limit: cq.claim_limit } : null;

  const team: TeamRow[] | null = isManager
    ? (summaryRes.data ?? []).map((s) => ({
        memberId: s.member_id,
        name: s.full_name,
        assigned: s.assigned,
        done: s.done,
        appointments: s.appointments,
      }))
    : null;

  const viewer: Viewer = {
    id: member.id,
    isManager,
    canImport: can(member, "import_customers"),
    canReassign: can(member, "reassign"),
    canDelete: can(member, "delete_customers"),
  };

  return (
    <BugunView
      viewer={viewer}
      sheetMembers={(membersRes.data ?? []) as MemberLite[]}
      greeting={greeting(now)}
      firstName={firstName(member.full_name)}
      dateLabel={formatWeekday(now)}
      todayKey={today}
      isManager={isManager}
      teamView={teamView}
      items={items}
      birthday={birthday}
      pool={pool}
      mode={mode}
      claim={claim}
      rulesText={rulesRes.data ?? ""}
      rules={{
        maxAttempts: settings.max_attempts,
        poolWaitDays: settings.pool_wait_days,
        maxRounds: settings.max_rounds,
      }}
      team={team}
      focusId={typeof focusParam === "string" ? focusParam : null}
    />
  );
}
