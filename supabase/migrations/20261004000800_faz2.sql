-- Telefoncu CRM, Faz 2: Telegram bildirimleri, raporlar, dışa aktarma (docs/spec-faz2.md §1, §2)
-- Eski migration dosyaları değişmez. Yeni fonksiyonlarda açık revoke/grant:
-- Supabase varsayılan yetkileri yeni fonksiyonları anon/authenticated'a da açar; burada kapatılır.

-- ---------------------------------------------------------------------------
-- §1. Kolon eklemeleri
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column telegram_enabled boolean not null default false,
  add column telegram_bot_username text check (telegram_bot_username is null or telegram_bot_username ~ '^[A-Za-z0-9_]{3,64}$'),
  add column reminder_hour int not null default 15 check (reminder_hour between 0 and 23);

alter table public.members
  add column telegram_chat_id bigint,
  add column telegram_linked_at timestamptz,
  add column notify_morning boolean not null default true,
  add column notify_reminder boolean not null default true,
  add column notify_summary boolean not null default true;

-- members güncelleme yetkisi kolon bazlı (0700): yeni kolonlar istemciye açılmaz,
-- yalnız security definer fonksiyonlar (set_notify_prefs, telegram_*) yazar.

-- ---------------------------------------------------------------------------
-- telegram_link_codes: doğrudan erişime kapalı (RLS açık, politika yok, yetki yok)
-- ---------------------------------------------------------------------------
create table public.telegram_link_codes (
  code text primary key check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  tenant_id uuid not null references public.tenants,
  member_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  foreign key (tenant_id, member_id) references public.members (tenant_id, id) on delete cascade
);
create index telegram_link_codes_member_idx on public.telegram_link_codes (member_id);

alter table public.telegram_link_codes enable row level security;
revoke all on table public.telegram_link_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- notification_log: select manager, yazma yalnız iç fonksiyon (service role)
-- ---------------------------------------------------------------------------
create table public.notification_log (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants,
  member_id uuid not null,
  kind text not null check (kind in ('morning', 'reminder', 'summary', 'test')),
  day date not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz default now(),
  foreign key (tenant_id, member_id) references public.members (tenant_id, id) on delete cascade
);
-- Aynı gün aynı tür bir kez (test hariç)
create unique index notification_log_once_idx on public.notification_log (member_id, kind, day) where kind <> 'test';
create index notification_log_tenant_created_idx on public.notification_log (tenant_id, created_at desc);

alter table public.notification_log enable row level security;

create policy notification_log_select on public.notification_log
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()));

revoke all on table public.notification_log from anon;
revoke insert, update, delete, truncate, references, trigger on table public.notification_log from authenticated;
revoke all on sequence public.notification_log_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rapor performansı: kiracı + zaman aralığı
-- ---------------------------------------------------------------------------
create index call_attempts_tenant_created_idx on public.call_attempts (tenant_id, created_at);
create index pipeline_events_tenant_created_idx on public.pipeline_events (tenant_id, created_at);
create index customers_tenant_created_idx on public.customers (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- §2. Kullanıcı fonksiyonları
-- ---------------------------------------------------------------------------

-- Çağıranın kendisi için 8 karakterlik bağlama kodu (15 dk, tek kullanım)
create or replace function public.telegram_create_link_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 32 karakter, 0/O/1/I yok
  v_code text;
  v_bytes bytea;
  i int;
  n int := 0;
begin
  delete from public.telegram_link_codes where member_id = m.id and used_at is null;

  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0 .. 7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
    end loop;
    begin
      insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at)
      values (v_code, m.tenant_id, m.id, now() + interval '15 minutes');
      exit;
    exception when unique_violation then
      n := n + 1;
      if n >= 5 then
        raise exception 'Bağlama kodu üretilemedi. Tekrar deneyin.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  return v_code;
end;
$$;

-- Kendi bağlantısını (null) veya manager ise kiracısındaki başkasının bağlantısını kaldırır
create or replace function public.telegram_unlink(p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_target uuid := coalesce(p_member, m.id);
begin
  if v_target <> m.id and m.role <> 'manager' then
    raise exception 'Başka bir çalışanın Telegram bağlantısını yalnız yönetici kaldırabilir.' using errcode = '42501';
  end if;

  update public.members
  set telegram_chat_id = null, telegram_linked_at = null
  where id = v_target and tenant_id = m.tenant_id;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  -- Bekleyen kodlar da geçersiz olsun
  delete from public.telegram_link_codes where member_id = v_target and used_at is null;

  perform public._audit(m.tenant_id, m.id, 'telegram_unlink', 'member', v_target, '{}'::jsonb);
end;
$$;

-- Kendi bildirim tercihleri (null verilen alan değişmez)
create or replace function public.set_notify_prefs(p_morning boolean, p_reminder boolean, p_summary boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  update public.members
  set notify_morning = coalesce(p_morning, notify_morning),
      notify_reminder = coalesce(p_reminder, notify_reminder),
      notify_summary = coalesce(p_summary, notify_summary)
  where id = m.id;
end;
$$;

-- Dışa aktarmayı denetim kaydına yazar (veri değil, özet: tür, satır sayısı, filtreler)
create or replace function public.log_export(p_kind text, p_rows int, p_filters jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if not (m.role = 'manager' or public._has_perm(m, 'export')) then
    raise exception 'Dışa aktarma yetkiniz yok.' using errcode = '42501';
  end if;
  if p_kind is null or btrim(p_kind) = '' or length(p_kind) > 40 then
    raise exception 'Geçersiz dışa aktarma türü.' using errcode = '22023';
  end if;
  if p_rows is null or p_rows < 0 then
    raise exception 'Geçersiz satır sayısı.' using errcode = '22023';
  end if;
  if p_filters is not null and jsonb_typeof(p_filters) <> 'object' then
    raise exception 'Filtreler nesne biçiminde olmalı.' using errcode = '22023';
  end if;

  perform public._audit(m.tenant_id, m.id, 'export', btrim(p_kind), null,
    jsonb_build_object('kind', btrim(p_kind), 'rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)));
end;
$$;

-- ---------------------------------------------------------------------------
-- report_range
-- Tanımlar:
--  attempts: aralıktaki arama denemeleri; customers_called: farklı müşteri
--  reached: outcome in (appointment, callback, not_interested, disqualified) olan denemeler
--  appointments: outcome = 'appointment' denemeleri (day_summary ile aynı tanım)
--  disqualified: outcome = 'disqualified' denemeleri
--  visited/applied/approved/completed/rejected/not_interested: pipeline_events'te aralıkta o aşamaya
--    geçen farklı müşteri
--  pooled / unreachable: aralıkta havuza düşen / ulaşılamadı kapanan geçişler (log_call audit kaydı)
--  new_customers: aralıkta oluşturulan müşteri
--  rates (0-1, payda 0 ise 0): reach_rate = reached/attempts, appointment_rate = appointments/reached,
--    visit_rate = visited/appointments, close_rate = completed/appointments
--  by_source/by_operator: aralıkta aranan (veya tamamlanan) müşterilerin kaynağına/operatörüne göre
-- ---------------------------------------------------------------------------
create or replace function public.report_range(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
  v_start timestamptz;
  v_end timestamptz;
  v_tz constant text := 'Europe/Istanbul';
  v_result jsonb;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'view_reports')) then
    raise exception 'Raporları görme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Tarih aralığı geçersiz.' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Rapor aralığı en fazla 366 gün olabilir.' using errcode = '22023';
  end if;

  v_start := public.tr_day_start(p_from);
  v_end := public.tr_day_start(p_to + 1);

  with
  att as materialized (
    select a.customer_id, a.member_id, a.outcome,
           (a.created_at at time zone v_tz)::date as dy,
           a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified') as is_reached
    from public.call_attempts a
    where a.tenant_id = m.tenant_id and a.created_at >= v_start and a.created_at < v_end
  ),
  pe as materialized (
    select e.customer_id, e.member_id, e.stage
    from public.pipeline_events e
    where e.tenant_id = m.tenant_id and e.created_at >= v_start and e.created_at < v_end
  ),
  fn as (
    select
      count(distinct customer_id) filter (where stage = 'visited')::int as visited,
      count(distinct customer_id) filter (where stage = 'applied')::int as applied,
      count(distinct customer_id) filter (where stage = 'approved')::int as approved,
      count(distinct customer_id) filter (where stage = 'completed')::int as completed,
      count(distinct customer_id) filter (where stage = 'rejected')::int as rejected,
      count(distinct customer_id) filter (where stage = 'not_interested')::int as not_interested
    from pe
  ),
  au as (
    select
      count(*) filter (where l.data ->> 'call_status' = 'pool')::int as pooled,
      count(*) filter (where l.data ->> 'call_status' = 'unreachable')::int as unreachable
    from public.audit_log l
    where l.tenant_id = m.tenant_id and l.action = 'log_call'
      and l.created_at >= v_start and l.created_at < v_end
  ),
  t as (
    select
      (select count(*) from att)::int as attempts,
      (select count(distinct customer_id) from att)::int as customers_called,
      (select count(*) from att where is_reached)::int as reached,
      (select count(*) from att where outcome = 'appointment')::int as appointments,
      (select count(*) from att where outcome = 'disqualified')::int as disqualified,
      (select count(*) from public.customers c
        where c.tenant_id = m.tenant_id and c.created_at >= v_start and c.created_at < v_end)::int as new_customers
  ),
  bm as (
    select mm.id as member_id, mm.full_name,
      (select count(*) from att a where a.member_id = mm.id)::int as attempts,
      (select count(*) from att a where a.member_id = mm.id and a.is_reached)::int as reached,
      (select count(*) from att a where a.member_id = mm.id and a.outcome = 'appointment')::int as appointments,
      (select count(distinct e.customer_id) from pe e where e.member_id = mm.id and e.stage = 'completed')::int as completed
    from public.members mm
    where mm.tenant_id = m.tenant_id
      and ((mm.is_active and mm.role = 'agent')
           or exists (select 1 from att a where a.member_id = mm.id)
           or exists (select 1 from pe e where e.member_id = mm.id))
  ),
  bd as (
    select g.d as day,
      count(a.customer_id)::int as attempts,
      count(a.customer_id) filter (where a.is_reached)::int as reached,
      count(a.customer_id) filter (where a.outcome = 'appointment')::int as appointments
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
    left join att a on a.dy = g.d::date
    group by g.d
  ),
  bo as (
    select outcome, count(*)::int as cnt from att group by outcome
  ),
  cs as (
    select c.id,
      coalesce(nullif(btrim(c.source_detail), ''), 'Belirtilmemiş') as src,
      coalesce(c.operator, 'Bilinmiyor') as op,
      exists (select 1 from att a where a.customer_id = c.id) as called,
      exists (select 1 from pe e where e.customer_id = c.id and e.stage = 'completed') as completed,
      (select count(*) from att a where a.customer_id = c.id and a.outcome = 'appointment')::int as appts
    from public.customers c
    where c.tenant_id = m.tenant_id
      and (c.id in (select customer_id from att)
           or c.id in (select customer_id from pe where stage = 'completed'))
  ),
  bs as (
    select src, count(*) filter (where called)::int as customers, sum(appts)::int as appointments,
           count(*) filter (where completed)::int as completed
    from cs group by src
  ),
  bop as (
    select op, count(*) filter (where called)::int as customers,
           count(*) filter (where completed)::int as completed
    from cs group by op
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'attempts', t.attempts,
      'customers_called', t.customers_called,
      'reached', t.reached,
      'appointments', t.appointments,
      'visited', fn.visited,
      'applied', fn.applied,
      'approved', fn.approved,
      'completed', fn.completed,
      'rejected', fn.rejected,
      'not_interested', fn.not_interested,
      'disqualified', t.disqualified,
      'pooled', au.pooled,
      'unreachable', au.unreachable,
      'new_customers', t.new_customers
    ),
    'rates', jsonb_build_object(
      'reach_rate', case when t.attempts = 0 then 0 else least(1, round(t.reached::numeric / t.attempts, 4)) end,
      'appointment_rate', case when t.reached = 0 then 0 else least(1, round(t.appointments::numeric / t.reached, 4)) end,
      'visit_rate', case when t.appointments = 0 then 0 else least(1, round(fn.visited::numeric / t.appointments, 4)) end,
      'close_rate', case when t.appointments = 0 then 0 else least(1, round(fn.completed::numeric / t.appointments, 4)) end
    ),
    'by_member', coalesce((select jsonb_agg(jsonb_build_object(
        'member_id', bm.member_id, 'full_name', bm.full_name, 'attempts', bm.attempts,
        'reached', bm.reached, 'appointments', bm.appointments, 'completed', bm.completed)
        order by bm.full_name, bm.member_id) from bm), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object(
        'day', bd.day::date, 'attempts', bd.attempts, 'reached', bd.reached, 'appointments', bd.appointments)
        order by bd.day) from bd), '[]'::jsonb),
    'by_outcome', coalesce((select jsonb_agg(jsonb_build_object('outcome', bo.outcome, 'count', bo.cnt)
        order by bo.cnt desc, bo.outcome) from bo), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object(
        'source_detail', bs.src, 'customers', bs.customers, 'appointments', bs.appointments, 'completed', bs.completed)
        order by bs.customers desc, bs.src) from bs), '[]'::jsonb),
    'by_operator', coalesce((select jsonb_agg(jsonb_build_object(
        'operator', bop.op, 'customers', bop.customers, 'completed', bop.completed)
        order by bop.customers desc, bop.op) from bop), '[]'::jsonb)
  )
  into v_result
  from t, fn, au;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- İç fonksiyonlar (yalnız service_role: Next.js route handler'ları)
-- ---------------------------------------------------------------------------

-- Bağlama kodunu tüketir; aynı chat başka üyeye bağlıysa o bağlantı kaldırılır
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
begin
  if p_chat_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into l from public.telegram_link_codes where code = v_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if l.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if l.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into m from public.members where id = l.member_id and is_active for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
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

-- Saati gelen, bugün o tür için kaydı olmayan, bağlı ve tercihi açık üyelere bildirim hedefleri.
-- Morning yalnız mevcut atamaları okur (dağıtımı tetiklemez); total 0 ise hedef yok.
create or replace function public._notification_targets(p_now timestamptz)
returns table (tenant_id uuid, member_id uuid, kind text, chat_id bigint, payload jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hour int := extract(hour from p_now at time zone 'Europe/Istanbul')::int;
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
  v_start timestamptz := public.tr_day_start((p_now at time zone 'Europe/Istanbul')::date);
  v_end timestamptz := public.tr_day_start((p_now at time zone 'Europe/Istanbul')::date + 1);
begin
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
    and s.distribution_hour = v_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_morning
    and x.total > 0
    and not exists (select 1 from public.notification_log n
                    where n.member_id = m.id and n.kind = 'morning' and n.day = v_day);

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
    and s.reminder_hour = v_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_reminder
    and x.retry_count > 0
    and not exists (select 1 from public.notification_log n
                    where n.member_id = m.id and n.kind = 'reminder' and n.day = v_day);

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
    and s.summary_hour = v_hour
    and m.is_active and m.telegram_chat_id is not null and m.notify_summary
    and (m.role = 'manager' or public._has_perm(m, 'view_reports'))
    and not exists (select 1 from public.notification_log n
                    where n.member_id = m.id and n.kind = 'summary' and n.day = v_day);
end;
$$;

-- Gönderim sonucunu kaydeder; aynı gün aynı tür (test hariç) ikinci kez yazılmaz
create or replace function public._notification_record(
  p_tenant uuid, p_member uuid, p_kind text, p_day date, p_status text, p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_log (tenant_id, member_id, kind, day, status, error)
  values (p_tenant, p_member, p_kind, p_day, p_status, left(p_error, 500))
  on conflict (member_id, kind, day) where kind <> 'test' do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE yetkileri
-- ---------------------------------------------------------------------------
revoke execute on function
  public.telegram_create_link_code(),
  public.telegram_unlink(uuid),
  public.set_notify_prefs(boolean, boolean, boolean),
  public.report_range(date, date),
  public.log_export(text, int, jsonb)
from public, anon;

grant execute on function
  public.telegram_create_link_code(),
  public.telegram_unlink(uuid),
  public.set_notify_prefs(boolean, boolean, boolean),
  public.report_range(date, date),
  public.log_export(text, int, jsonb)
to authenticated;

revoke execute on function
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz),
  public._notification_record(uuid, uuid, text, date, text, text)
from public, anon, authenticated;

grant execute on function
  public._telegram_consume_link_code(text, bigint),
  public._notification_targets(timestamptz),
  public._notification_record(uuid, uuid, text, date, text, text)
to service_role;
