-- Telefoncu CRM, Faz 2 inceleme düzeltmeleri (docs/review-faz2.md: O1, O2 (DB kısmı yok), D2, D3, D4, D5)
-- Eski migration dosyaları değişmez. Yeni/yeniden tanımlanan fonksiyonlarda açık revoke/grant.

-- ---------------------------------------------------------------------------
-- D3. notification_log: önce sahiplen ('sending'), sonra gönder, sonra sonucu yaz
-- ---------------------------------------------------------------------------
alter table public.notification_log
  add column attempts int not null default 1 check (attempts between 1 and 100),
  add column claimed_at timestamptz not null default now();

alter table public.notification_log drop constraint notification_log_status_check;
alter table public.notification_log
  add constraint notification_log_status_check check (status in ('sending', 'sent', 'failed', 'skipped'));

create index notification_log_member_kind_claimed_idx on public.notification_log (member_id, kind, claimed_at desc);

-- Bir hedef için gönderim hakkını alır. Dönen id ile gönderim yapılır ve _notification_finish çağrılır.
-- null: başka bir çağrı sahiplenmiş, zaten gönderilmiş, deneme hakkı bitmiş ya da (test) dakikada 1 sınırı.
create or replace function public._notification_claim(p_tenant uuid, p_member uuid, p_kind text, p_day date)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_tenant is null or p_member is null or p_kind is null or p_day is null then
    raise exception 'Bildirim için kiracı, üye, tür ve gün zorunludur.' using errcode = '22023';
  end if;

  -- D5. Test mesajı: üye başına dakikada 1 (üye satırı kilitlenerek eşzamanlı istekler sıralanır)
  if p_kind = 'test' then
    perform 1 from public.members where id = p_member and tenant_id = p_tenant for update;
    if not found then
      raise exception 'Üye bulunamadı.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.notification_log n
               where n.member_id = p_member and n.kind = 'test' and n.claimed_at > now() - interval '1 minute') then
      return null;
    end if;
    insert into public.notification_log (tenant_id, member_id, kind, day, status, attempts, claimed_at)
    values (p_tenant, p_member, 'test', p_day, 'sending', 1, now())
    returning id into v_id;
    return v_id;
  end if;

  insert into public.notification_log (tenant_id, member_id, kind, day, status, attempts, claimed_at)
  values (p_tenant, p_member, p_kind, p_day, 'sending', 1, now())
  on conflict (member_id, kind, day) where kind <> 'test' do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  -- Mevcut satır: başarısız (veya 10 dakikadan eski, yarım kalmış 'sending') ve 3 denemeden azsa yeniden sahiplen
  update public.notification_log n
  set status = 'sending', attempts = n.attempts + 1, claimed_at = now(), error = null
  where n.member_id = p_member and n.tenant_id = p_tenant and n.kind = p_kind and n.day = p_day
    and n.attempts < 3
    and (n.status = 'failed' or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes'))
  returning n.id into v_id;
  return v_id;
end;
$$;

-- Sahiplenilen satırın son durumunu yazar
create or replace function public._notification_finish(p_id bigint, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Geçersiz bildirim durumu.' using errcode = '22023';
  end if;
  update public.notification_log
  set status = p_status, error = left(p_error, 500)
  where id = p_id and status = 'sending';
end;
$$;

-- ---------------------------------------------------------------------------
-- O1 + D3. Hedefler: saat koşulu ">= ayar saati" (o günün kalanında yakalanır);
-- dedup yalnız gönderilmiş, son 10 dakikada sahiplenilmiş veya 3 denemesi bitmiş kayıtlar.
-- Morning: kiracıda bugün hiç atama yoksa ve dağıtım saati geçtiyse önce dağıtım (idempotent).
-- ---------------------------------------------------------------------------
create or replace function public._notification_done(p_member uuid, p_kind text, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.notification_log n
    where n.member_id = p_member and n.kind = p_kind and n.day = p_day
      and (n.status not in ('failed', 'sending')
           or n.attempts >= 3
           or (n.status = 'sending' and n.claimed_at >= now() - interval '10 minutes')));
$$;

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
-- D4. Bağlama kodu denemelerinde sohbet başına sınır: saatte 5 başarısız denemeden sonra
-- kod kontrol edilmez ve bot yanıt vermez ('rate_limited'). 24 saatten eski kayıtlar silinir.
-- ---------------------------------------------------------------------------
create table public.telegram_link_attempts (
  chat_id bigint not null,
  at timestamptz not null default now()
);
create index telegram_link_attempts_chat_at_idx on public.telegram_link_attempts (chat_id, at);
create index telegram_link_attempts_at_idx on public.telegram_link_attempts (at);

alter table public.telegram_link_attempts enable row level security;
revoke all on table public.telegram_link_attempts from anon, authenticated;

create or replace function public._telegram_link_limited(p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.telegram_link_attempts where at < now() - interval '24 hours';
  return (select count(*) from public.telegram_link_attempts a
          where a.chat_id = p_chat_id and a.at > now() - interval '1 hour') >= 5;
end;
$$;

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

  -- Aynı chat başka üyeye bağlıysa önceki bağlantı kalkar
  update public.members
  set telegram_chat_id = null, telegram_linked_at = null
  where telegram_chat_id = p_chat_id and id <> m.id;

  update public.members
  set telegram_chat_id = p_chat_id, telegram_linked_at = now()
  where id = m.id;

  update public.telegram_link_codes set used_at = now() where code = l.code;

  select name into v_tenant from public.tenants where id = m.tenant_id;

  perform public._audit(m.tenant_id, m.id, 'telegram_link', 'member', m.id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'full_name', m.full_name, 'tenant_name', v_tenant);
end;
$$;

-- ---------------------------------------------------------------------------
-- D2. members INSERT: istemci Telegram ve bildirim kolonlarını yazamaz (kolon bazlı yetki)
-- ---------------------------------------------------------------------------
revoke insert on table public.members from authenticated;
grant insert (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on, created_at)
  on table public.members to authenticated;

-- ---------------------------------------------------------------------------
-- EXECUTE yetkileri: hepsi iç fonksiyon, yalnız service_role
-- (_telegram_consume_link_code ve _notification_targets yeniden tanımlandı; yetkiler korunur, yine de açıkça yazılır)
-- ---------------------------------------------------------------------------
revoke execute on function
  public._notification_claim(uuid, uuid, text, date),
  public._notification_finish(bigint, text, text),
  public._notification_done(uuid, text, date),
  public._telegram_link_limited(bigint),
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz)
from public, anon, authenticated;

grant execute on function
  public._notification_claim(uuid, uuid, text, date),
  public._notification_finish(bigint, text, text),
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz)
to service_role;
