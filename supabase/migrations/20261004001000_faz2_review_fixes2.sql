-- Telefoncu CRM, Faz 2 inceleme düzeltmeleri 2. tur (docs/review-faz2.md: D9, Ş2, D1)
-- Eski migration dosyaları değişmez. Yeni/yeniden tanımlanan fonksiyonlarda açık revoke/grant.

-- ---------------------------------------------------------------------------
-- Ş2. Bir Telegram sohbeti en fazla bir üyeye bağlı olabilir
-- (yerel veride çakışma yok, sorgulanarak doğrulandı)
-- ---------------------------------------------------------------------------
create unique index members_telegram_chat_id_key
  on public.members (telegram_chat_id)
  where telegram_chat_id is not null;

-- Aynı sohbet başka üyeye bağlıysa önceki bağlantı kalkar (0900 ile aynı).
-- Eşzamanlı iki tüketim aynı sohbeti iki üyeye bağlamaya çalışırsa unique indeks
-- ikincisini durdurur; hata 500 yerine 'invalid' olarak döner ve kod kullanılmamış kalır.
create or replace function public._telegram_consume_link_code(p_code text, p_chat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  l public.telegram_link_codes;
  m public.members;
  v_tenant text;
  v_reason text;
begin
  if p_chat_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if public._telegram_link_limited(p_chat_id) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into l from public.telegram_link_codes where code = v_code for update;
  if not found then
    v_reason := 'invalid';
  elsif l.used_at is not null then
    v_reason := 'used';
  elsif l.expires_at <= now() then
    v_reason := 'expired';
  else
    select * into m from public.members where id = l.member_id and is_active for update;
    if not found then
      v_reason := 'invalid';
    end if;
  end if;

  if v_reason is not null then
    insert into public.telegram_link_attempts (chat_id) values (p_chat_id);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  begin
    update public.members
    set telegram_chat_id = null, telegram_linked_at = null
    where telegram_chat_id = p_chat_id and id <> m.id;

    update public.members
    set telegram_chat_id = p_chat_id, telegram_linked_at = now()
    where id = m.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end;

  update public.telegram_link_codes set used_at = now() where code = l.code;

  select name into v_tenant from public.tenants where id = m.tenant_id;

  perform public._audit(m.tenant_id, m.id, 'telegram_link', 'member', m.id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'full_name', m.full_name, 'tenant_name', v_tenant);
end;
$$;

-- ---------------------------------------------------------------------------
-- D9. İzinli (absent_on = bugün) üyeye sabah ve hatırlatma mesajı gitmez
-- (0900 tanımı ile aynı; yalnız morning ve reminder koşuluna absent_on eklendi)
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
           'birthdays', coalesce(b.birthdays, '[]'::jsonb))
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
  where s.telegram_enabled
    and v_hour >= s.distribution_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_morning
    and m.absent_on is distinct from v_day
    and x.total > 0
    and not public._notification_done(m.id, 'morning', v_day);

  -- Tekrar arama hatırlatması
  return query
  select m.tenant_id, m.id, 'reminder'::text, m.telegram_chat_id,
         jsonb_build_object('first_name', split_part(btrim(m.full_name), ' ', 1), 'retry_count', x.retry_count)
  from public.members m
  join public.tenant_settings s on s.tenant_id = m.tenant_id
  cross join lateral (
    select count(*)::int as retry_count
    from public.daily_assignments d
    join public.customers c on c.id = d.customer_id
    where d.member_id = m.id and d.day = v_day and c.call_status = 'retry'
  ) x
  where s.telegram_enabled
    and v_hour >= s.reminder_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_reminder
    and m.absent_on is distinct from v_day
    and x.retry_count > 0
    and not public._notification_done(m.id, 'reminder', v_day);

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
          where d.member_id = mm.id and d.day = v_day)::int as assigned,
        (select count(*) from public.daily_assignments d
          join public.customers c on c.id = d.customer_id
          where d.member_id = mm.id and d.day = v_day
            and not (c.call_status in ('pending', 'retry') and c.next_call_at < v_end))::int as done,
        (select count(distinct a.customer_id) from public.call_attempts a
          where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
            and a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified'))::int as reached,
        (select count(*) from public.call_attempts a
          where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
            and a.outcome = 'appointment')::int as appointments,
        (select count(*) from public.daily_assignments d
          join public.customers c on c.id = d.customer_id
          where d.member_id = mm.id and d.day = v_day and c.call_status = 'retry')::int as retries
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

-- ---------------------------------------------------------------------------
-- D1. members SELECT kolon bazlı: telegram_chat_id istemciye kapalı.
-- Bağlı olma bilgisi telegram_linked_at üzerinden okunur (ikisi birlikte yazılır/temizlenir).
-- Sohbet kimliğini yalnız security definer fonksiyonlar ve service_role okur.
-- ---------------------------------------------------------------------------
revoke select on table public.members from authenticated;
grant select (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on, created_at,
              telegram_linked_at, notify_morning, notify_reminder, notify_summary)
  on table public.members to authenticated;

-- ---------------------------------------------------------------------------
-- EXECUTE yetkileri: yeniden tanımlanan iç fonksiyonlar yalnız service_role
-- ---------------------------------------------------------------------------
revoke execute on function
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz)
from public, anon, authenticated;

grant execute on function
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz)
to service_role;
