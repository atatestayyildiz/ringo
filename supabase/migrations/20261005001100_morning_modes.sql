-- Sabah Telegram mesajı (2026-10-05): free_pool ve manual modlarında da, dağıtım saati geçtiyse
-- hedefler hesaplanmadan önce o günün moda uygun (idempotent) dağıtımı çalışır; böylece sahibin vakti
-- gelen tekrar aramaları sabah sayısına girer. auto_even davranışı aynı.
-- Ayrıca take_from_pool serbest havuzda kapalı (en altta).
-- _notification_targets gövdesi 20261005000700_schedule_minutes.sql ile aynı; yalnız ilk blok değişti.

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
  -- Sabah sayısı eksik olmasın: dağıtım saati geçtiyse önce bugünün moda uygun dağıtımı yapılır.
  -- auto_even: yalnız bugün ataması yokken (eskisi gibi). free_pool / manual: her çağrıda (idempotent;
  -- sahibin vakti gelen açık müşterisi listesine konur, yeni müşteri atanmaz).
  if v_day = public.tr_today() then
    for t in
      select s.tenant_id
      from public.tenant_settings s
      where s.telegram_enabled
        and v_time >= make_time(s.distribution_hour, s.distribution_minute, 0)
        and (
          (s.distribution_mode = 'auto_even'
           and not exists (select 1 from public.daily_assignments d
                           where d.tenant_id = s.tenant_id and d.day = v_day))
          or s.distribution_mode in ('free_pool', 'manual')
        )
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
-- take_from_pool (kullanıcı kararı 2026-10-05): serbest havuz modunda havuz yalnız görüntülenir, 22023.
-- Gövde 20261005001000_distribution_modes.sql ile aynı; auto_even ve manual davranışı değişmez.
-- ---------------------------------------------------------------------------
create or replace function public.take_from_pool(p_customer uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
  c public.customers;
  v_today date := public.tr_today();
  v_from uuid;
  v_pos int;
begin
  if m.absent_on is not distinct from v_today then
    raise exception 'Bugün izinli olarak işaretlisiniz, havuzdan müşteri alamazsınız.' using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  -- Serbest havuzda havuz yalnız görüntülenir; dönen müşteri Sıradakini al kuyruğuna girer
  if s.tenant_id is not null and s.distribution_mode = 'free_pool' then
    raise exception 'Serbest havuz modunda müşteriler Sıradakini al ile alınır.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  if s.tenant_id is not null and s.distribution_mode = 'auto_even'
     and not exists (select 1 from public.daily_assignments d
                     where d.tenant_id = m.tenant_id and d.day = v_today) then
    if (now() at time zone 'Europe/Istanbul')::time >= make_time(s.distribution_hour, s.distribution_minute, 0) then
      perform public._distribute_day_for(m.tenant_id, v_today);
    else
      raise exception 'Bugünün dağıtımı henüz yapılmadı. Dağıtımdan sonra havuzdan alabilirsiniz.'
        using errcode = '22023';
    end if;
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or c.call_status <> 'pool' then
    raise exception 'Bu müşteri havuzda değil, başka biri almış olabilir.' using errcode = '22023';
  end if;

  v_from := c.assigned_to;

  update public.customers set
    assigned_to = m.id,
    call_status = 'pending',
    attempts_in_round = 0,
    next_call_at = now(),
    updated_at = now()
  where id = c.id
  returning * into c;

  select coalesce(max(d.position), 0) + 1 into v_pos
  from public.daily_assignments d
  where d.tenant_id = m.tenant_id and d.day = v_today and d.member_id = m.id;

  insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
  values (m.tenant_id, v_today, c.id, m.id, v_pos)
  on conflict (day, customer_id) do update
    set member_id = excluded.member_id, position = excluded.position
    where public.daily_assignments.member_id <> excluded.member_id;

  perform public._audit(m.tenant_id, m.id, 'take_from_pool', 'customer', c.id,
    jsonb_build_object('from', v_from, 'to', m.id, 'pool_count', c.pool_count));
  return c;
end;
$$;

revoke execute on function public.take_from_pool(uuid) from public, anon;
grant execute on function public.take_from_pool(uuid) to authenticated;
