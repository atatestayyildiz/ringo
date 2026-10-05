-- Gönderim saatleri dakika bazlı (2026-10-05): sabah listesi ve akşam özeti hh:mm.
-- Zaman = *_hour:*_minute (Europe/Istanbul yerel). Karşılaştırma "şimdi >= hh:mm"; gün içinde bir kez
-- gönderim notification_log (_notification_done) ve daily_assignments varlığıyla korunur.
-- pg_cron dağıtım işi saatlikten 5 dakikalığa çekildi.

alter table public.tenant_settings
  add column distribution_minute smallint not null default 0
    check (distribution_minute between 0 and 59),
  add column summary_minute smallint not null default 0
    check (summary_minute between 0 and 59);

-- ---------------------------------------------------------------------------
-- _scheduled_distribution_at: verilen andaki yerel saate göre, dağıtım zamanı gelmiş ve bugün için
-- henüz ataması olmayan auto_even kiracıları dağıtır. İç fonksiyon (test edilebilir zaman parametresi).
-- ---------------------------------------------------------------------------
create or replace function public._scheduled_distribution_at(p_now timestamptz)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Istanbul';
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
  v_total int := 0;
  t record;
begin
  for t in
    select s.tenant_id from public.tenant_settings s
    where s.distribution_mode = 'auto_even'
      and v_local::time >= make_time(s.distribution_hour, s.distribution_minute, 0)
      and not exists (select 1 from public.daily_assignments d
                      where d.tenant_id = s.tenant_id and d.day = v_day)
  loop
    v_total := v_total + public._distribute_day_for(t.tenant_id, v_day);
  end loop;
  return v_total;
end;
$$;

revoke execute on function public._scheduled_distribution_at(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- run_scheduled_distribution: pg_cron 5 dakikada bir çağırır (ACL değişmez)
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_distribution()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public._scheduled_distribution_at(now());
end;
$$;

revoke execute on function public.run_scheduled_distribution() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _notification_targets: saat karşılaştırması dakika bazlı (yerel saat >= hh:mm). Gövde
-- 20261005000500_appointment_time.sql ile aynı; yalnız v_hour yerine v_time kullanıldı.
-- ---------------------------------------------------------------------------
create or replace function public._notification_targets(p_now timestamptz)
returns table (tenant_id uuid, member_id uuid, kind text, chat_id bigint, payload jsonb)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_time time := (p_now at time zone 'Europe/Istanbul')::time;
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
  v_start timestamptz := public.tr_day_start((p_now at time zone 'Europe/Istanbul')::date);
  v_end timestamptz := public.tr_day_start((p_now at time zone 'Europe/Istanbul')::date + 1);
  t record;
begin
  -- Dağıtım kaçtıysa (pg_cron gecikmesi/başarısızlığı) bugünün dağıtımını yap
  if v_day = public.tr_today() then
    for t in
      select s.tenant_id
      from public.tenant_settings s
      where s.telegram_enabled
        and s.distribution_mode = 'auto_even'
        and v_time >= make_time(s.distribution_hour, s.distribution_minute, 0)
        and not exists (select 1 from public.daily_assignments d
                        where d.tenant_id = s.tenant_id and d.day = v_day)
    loop
      perform public._distribute_day_for(t.tenant_id, v_day);
    end loop;
  end if;

  -- Sabah: bugünkü atamalar
  return query
  select m.tenant_id, m.id, 'morning'::text, m.telegram_chat_id,
         jsonb_build_object(
           'first_name', split_part(btrim(m.full_name), ' ', 1),
           'total', x.total,
           'retries', x.retries,
           'new', x.new_count,
           'birthdays', coalesce(b.birthdays, '[]'::jsonb),
           'appointments_today', ap.appointments_today)
  from public.members m
  join public.tenant_settings s on s.tenant_id = m.tenant_id
  cross join lateral (
    select count(*)::int as total,
           (count(*) filter (where c.call_status = 'retry'))::int as retries,
           (count(*) filter (where c.call_status = 'pending'))::int as new_count
    from public.daily_assignments d
    join public.customers c on c.id = d.customer_id
    where d.member_id = m.id and d.day = v_day
  ) x
  cross join lateral (
    select jsonb_agg(jsonb_build_object('full_name', q.full_name, 'days_left', q.days_left)
                     order by q.days_left, q.full_name) as birthdays
    from (
      select c.full_name, (public.birthday_next(c.birth_date, v_day) - v_day)::int as days_left
      from public.daily_assignments d
      join public.customers c on c.id = d.customer_id
      where d.member_id = m.id and d.day = v_day and c.birth_date is not null
        and public.birthday_next(c.birth_date, v_day) - v_day <= s.birthday_notice_days
    ) q
  ) b
  cross join lateral (
    select count(*)::int as appointments_today
    from public.customers c
    where c.tenant_id = m.tenant_id and c.assigned_to = m.id
      and c.pipeline_stage = 'appointment' and c.appointment_day = v_day
  ) ap
  where s.telegram_enabled
    and v_time >= make_time(s.distribution_hour, s.distribution_minute, 0)
    and m.is_active and m.telegram_chat_id is not null and m.notify_morning
    and m.absent_on is distinct from v_day
    and x.total > 0
    and not public._notification_done(m.id, 'morning', v_day);

  -- Gün sonu özeti (manager ve view_reports); day_summary ile aynı tanımlar
  return query
  select m.tenant_id, m.id, 'summary'::text, m.telegram_chat_id,
         jsonb_build_object('day', v_day, 'totals', ds.totals, 'members', ds.members)
  from public.members m
  join public.tenant_settings s on s.tenant_id = m.tenant_id
  cross join lateral (
    select
      jsonb_build_object(
        'assigned', coalesce(sum(y.assigned), 0)::int,
        'done', coalesce(sum(y.done), 0)::int,
        'reached', coalesce(sum(y.reached), 0)::int,
        'appointments', coalesce(sum(y.appointments), 0)::int,
        'retries', coalesce(sum(y.retries), 0)::int) as totals,
      coalesce(jsonb_agg(jsonb_build_object(
        'full_name', y.full_name, 'assigned', y.assigned, 'done', y.done, 'appointments', y.appointments)
        order by y.full_name, y.id), '[]'::jsonb) as members
    from (
      select mm.id, mm.full_name,
        (select count(*) from public.daily_assignments d
          join public.customers c on c.id = d.customer_id
          where d.member_id = mm.id and d.day = v_day
            and not (c.call_status = 'retry' and c.next_call_at >= v_end))::int as assigned,
        (select count(*) from public.daily_assignments d
          join public.customers c on c.id = d.customer_id
          where d.member_id = mm.id and d.day = v_day
            and not (c.call_status in ('pending', 'retry') and c.next_call_at < v_end)
            and not (c.call_status = 'retry' and c.next_call_at >= v_end))::int as done,
        (select count(distinct a.customer_id) from public.call_attempts a
          where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
            and a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified'))::int as reached,
        (select count(*) from public.call_attempts a
          where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
            and a.outcome = 'appointment')::int as appointments,
        (select count(*) from public.daily_assignments d
          join public.customers c on c.id = d.customer_id
          where d.member_id = mm.id and d.day = v_day and c.call_status = 'retry'
            and c.next_call_at < v_end)::int as retries
      from public.members mm
      where mm.tenant_id = m.tenant_id
        and ((mm.is_active and mm.role = 'agent')
             or exists (select 1 from public.daily_assignments d where d.member_id = mm.id and d.day = v_day))
    ) y
  ) ds
  where s.telegram_enabled
    and v_time >= make_time(s.summary_hour, s.summary_minute, 0)
    and m.is_active and m.telegram_chat_id is not null and m.notify_summary
    and (m.role = 'manager' or public._has_perm(m, 'view_reports'))
    and not public._notification_done(m.id, 'summary', v_day);
end;
$$;

revoke execute on function public._notification_targets(timestamptz) from public, anon, authenticated;
grant execute on function public._notification_targets(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- pg_cron: saatlikten 5 dakikalığa
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'telefoncu-distribution') then
    perform cron.unschedule('telefoncu-distribution');
  end if;
end;
$$;

select cron.schedule(
  'telefoncu-distribution',
  '*/5 * * * *',
  $$select public.run_scheduled_distribution()$$
);
