-- Randevu zamanı (2026-10-05): "Dükkana gelecek" (outcome/pipeline_stage 'appointment') için gün ve saat.
-- appointment_day/appointment_time Europe/Istanbul yereldir; ikisi null = "belli değil, uğrayacak".
-- Kolonları yalnız RPC yazar (log_call, set_appointment); istemciye doğrudan UPDATE kolon yetkisi verilmez.
-- Eski migration dosyaları değişmez. Yeni/yeniden tanımlanan fonksiyonlarda açık revoke/grant.

-- ---------------------------------------------------------------------------
-- Kolonlar
-- ---------------------------------------------------------------------------
alter table public.customers
  add column appointment_day date,
  add column appointment_time time,
  add constraint customers_appointment_time_needs_day
    check (appointment_time is null or appointment_day is not null);

create index customers_tenant_appointment_idx
  on public.customers (tenant_id, appointment_day)
  where pipeline_stage = 'appointment';

-- Doğrudan UPDATE: önceki tablo düzeyi yetki mevcut kolonlarla aynen korunur, randevu kolonları hariç.
revoke update on table public.customers from authenticated;
grant update (
  id, tenant_id, full_name, phone, phone_alt, operator, birth_date, source, source_detail, applied_at,
  call_status, pipeline_stage, attempts_in_round, pool_count, next_call_at, assigned_to,
  last_outcome, last_note, consent, created_at, updated_at
) on table public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- log_call: randevu günü/saati (opsiyonel). Eski 4 parametreli imza kaldırılır; yeni imza
-- varsayılanlarla eski çağrıları (4 parametre) aynen karşılar.
-- ---------------------------------------------------------------------------
drop function public.log_call(uuid, text, text, timestamptz);

create function public.log_call(
  p_customer uuid,
  p_outcome text,
  p_note text default null,
  p_callback_at timestamptz default null,
  p_appointment_day date default null,
  p_appointment_time time default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
  c public.customers;
  v_note text := nullif(btrim(p_note), '');
  v_tz constant text := 'Europe/Istanbul';
begin
  if p_outcome is null or p_outcome not in
     ('appointment', 'callback', 'no_answer', 'busy', 'disqualified', 'not_interested', 'wrong_number') then
    raise exception 'Geçersiz arama sonucu. Listeden bir sonuç seçin.' using errcode = '22023';
  end if;

  if p_outcome <> 'appointment' and (p_appointment_day is not null or p_appointment_time is not null) then
    raise exception 'Randevu günü ve saati yalnız "Dükkana gelecek" sonucunda girilebilir.' using errcode = '22023';
  end if;
  if p_appointment_time is not null and p_appointment_day is null then
    raise exception 'Randevu saati için önce gün seçin.' using errcode = '22023';
  end if;
  if p_appointment_day is not null and p_appointment_day < public.tr_today() then
    raise exception 'Randevu günü bugünden önce olamaz.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_work(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  if c.call_status not in ('pending', 'retry') then
    raise exception 'Bu müşteri için arama kaydı açık değil (durum: %).',
      case c.call_status
        when 'pool' then 'havuzda'
        when 'done' then 'tamamlandı'
        when 'unreachable' then 'ulaşılamadı'
        when 'disqualified' then 'uygun değil'
        else c.call_status
      end
      using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı. Yöneticinize başvurun.' using errcode = 'P0002';
  end if;

  if p_outcome = 'callback' then
    if p_callback_at is null or p_callback_at <= now() then
      raise exception 'Geri arama zamanı gelecekte bir tarih ve saat olmalı.' using errcode = '22023';
    end if;
  end if;

  insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, note, callback_at)
  values (m.tenant_id, c.id, m.id, p_outcome, v_note,
          case when p_outcome = 'callback' then p_callback_at end);

  c.last_outcome := p_outcome;
  c.last_note := v_note;

  case p_outcome
    when 'appointment' then
      c.call_status := 'done';
      c.pipeline_stage := 'appointment';
      c.appointment_day := p_appointment_day;
      c.appointment_time := p_appointment_time;
      insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
      values (m.tenant_id, c.id, m.id, 'appointment', v_note);
    when 'not_interested' then
      c.call_status := 'done';
      c.pipeline_stage := 'not_interested';
      insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
      values (m.tenant_id, c.id, m.id, 'not_interested', v_note);
    when 'disqualified', 'wrong_number' then
      c.call_status := 'disqualified';
    when 'callback' then
      c.call_status := 'retry';
      c.next_call_at := p_callback_at;
    else -- no_answer, busy
      c.attempts_in_round := c.attempts_in_round + 1;
      if c.attempts_in_round < s.max_attempts then
        c.call_status := 'retry';
        c.next_call_at := now();
      elsif c.pool_count < s.max_rounds then
        c.call_status := 'pool';
        c.pool_count := c.pool_count + 1;
        c.attempts_in_round := 0;
        c.next_call_at := public.tr_day_start(((now() at time zone v_tz)::date + s.pool_wait_days));
      else
        c.call_status := 'unreachable';
      end if;
  end case;

  update public.customers set
    call_status = c.call_status,
    pipeline_stage = c.pipeline_stage,
    attempts_in_round = c.attempts_in_round,
    pool_count = c.pool_count,
    next_call_at = c.next_call_at,
    last_outcome = c.last_outcome,
    last_note = c.last_note,
    appointment_day = c.appointment_day,
    appointment_time = c.appointment_time,
    updated_at = now()
  where id = c.id
  returning * into c;

  perform public._audit(m.tenant_id, m.id, 'log_call', 'customer', c.id,
    jsonb_build_object('outcome', p_outcome, 'call_status', c.call_status,
                       'attempts_in_round', c.attempts_in_round, 'pool_count', c.pool_count)
    || case when p_outcome = 'appointment'
         then jsonb_build_object('appointment_day', c.appointment_day, 'appointment_time', c.appointment_time)
         else '{}'::jsonb end);
  return c;
end;
$$;

revoke execute on function public.log_call(uuid, text, text, timestamptz, date, time) from public, anon;
grant execute on function public.log_call(uuid, text, text, timestamptz, date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- set_appointment: randevu aşamasındaki müşterinin gün/saatini değiştirir veya temizler
-- (ikisi null = belli değil). Yetki log_call ile aynı (_can_work, kiracı sınırı).
-- ---------------------------------------------------------------------------
create or replace function public.set_appointment(
  p_customer uuid,
  p_day date default null,
  p_time time default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
begin
  if p_time is not null and p_day is null then
    raise exception 'Randevu saati için önce gün seçin.' using errcode = '22023';
  end if;
  if p_day is not null and p_day < public.tr_today() then
    raise exception 'Randevu günü bugünden önce olamaz.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_work(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  if c.pipeline_stage is distinct from 'appointment' then
    raise exception 'Randevu zamanı yalnız "Dükkana gelecek" aşamasındaki müşteride değiştirilebilir.'
      using errcode = '22023';
  end if;

  update public.customers set
    appointment_day = p_day,
    appointment_time = p_time,
    updated_at = now()
  where id = c.id
  returning * into c;

  perform public._audit(m.tenant_id, m.id, 'set_appointment', 'customer', c.id,
    jsonb_build_object('appointment_day', p_day, 'appointment_time', p_time));
  return c;
end;
$$;

revoke execute on function public.set_appointment(uuid, date, time) from public, anon;
grant execute on function public.set_appointment(uuid, date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- set_pipeline_stage: başka aşamadan 'appointment'a taşınınca randevu zamanı "belli değil" (null).
-- Randevu aşamasından çıkınca kolonlar temizlenmez (geçmiş kalır). Gövde 20261004000400_rpc.sql ile aynı.
-- ---------------------------------------------------------------------------
create or replace function public.set_pipeline_stage(
  p_customer uuid,
  p_stage text,
  p_note text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_note text := nullif(btrim(p_note), '');
  v_enter_appt boolean;
begin
  if p_stage is null or p_stage not in
     ('appointment', 'visited', 'applied', 'approved', 'rejected', 'completed', 'not_interested') then
    raise exception 'Geçersiz huni aşaması.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_work(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  v_enter_appt := p_stage = 'appointment' and c.pipeline_stage is distinct from 'appointment';

  update public.customers set
    pipeline_stage = p_stage,
    call_status = case when p_stage in ('completed', 'rejected', 'not_interested') then 'done' else call_status end,
    appointment_day = case when v_enter_appt then null else appointment_day end,
    appointment_time = case when v_enter_appt then null else appointment_time end,
    updated_at = now()
  where id = c.id
  returning * into c;

  insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
  values (m.tenant_id, c.id, m.id, p_stage, v_note);

  perform public._audit(m.tenant_id, m.id, 'set_pipeline_stage', 'customer', c.id,
    jsonb_build_object('stage', p_stage));
  return c;
end;
$$;

revoke execute on function public.set_pipeline_stage(uuid, text, text) from public, anon;
grant execute on function public.set_pipeline_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- _notification_targets: morning payload'a appointments_today (üyeye atanmış, randevu aşamasında,
-- randevu günü bugün). Gövde 20261005000400_remove_reminder.sql ile aynı; yalnız bu alan eklendi.
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
  v_hour int := extract(hour from p_now at time zone 'Europe/Istanbul')::int;
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
        and v_hour >= s.distribution_hour
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
    and v_hour >= s.distribution_hour
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
    and v_hour >= s.summary_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_summary
    and (m.role = 'manager' or public._has_perm(m, 'view_reports'))
    and not public._notification_done(m.id, 'summary', v_day);
end;
$$;

revoke execute on function public._notification_targets(timestamptz) from public, anon, authenticated;
grant execute on function public._notification_targets(timestamptz) to service_role;
