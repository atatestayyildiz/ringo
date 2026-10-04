-- Rapor kapsamı ve Yönetim yetkisi (Şef kararı, review-faz2 D7)
--
-- 1. report_range kapsamı DB'de belirlenir:
--    yönetici veya view_reports -> ekip geneli (kiracının toplamları; müşteri listesi yok)
--    diğer çalışanlar          -> yalnız kendi sayıları (istemci parametresiyle genişletilemez)
-- 2. report_range_member(p_from, p_to, p_member): tek çalışanın kapsamı ("Ben" görünümü).
--    Yetkisiz çalışan yalnız kendi member_id'sini isteyebilir; başkası 42501.
-- 3. Yeni yetki anahtarı view_team: Yönetim ekranı (ekip özet kartları, kim ne yaptı).
--    day_summary: yönetici, view_team veya view_reports (ekip toplamları).
--    daily_assignments başkalarının satırları: yönetici veya view_team (view_reports artık değil).
--    Geçiş: view_reports = true olan üyelere view_team = true verilir (davranış korunur).
-- Gün sonu Telegram özeti (_notification_targets) view_reports ile kalır (ekip raporu).
-- Ş3: by_member ve by_source/by_operator satır başına alt sorgu yerine ön toplamlarla.

-- ---------------------------------------------------------------------------
-- Geçiş: mevcut view_reports sahiplerine view_team
-- ---------------------------------------------------------------------------
update public.members
set permissions = permissions || '{"view_team": true}'::jsonb
where permissions -> 'view_reports' = 'true'::jsonb
  and not (permissions ? 'view_team');

-- ---------------------------------------------------------------------------
-- _report_range (iç): p_member null -> kiracı geneli, dolu -> o üyenin kapsamı
-- Üye kapsamı:
--  att: üyenin kendi denemeleri
--  pe: üyenin yaptığı aşama geçişleri + üyeye atanmış ya da üyenin aradığı müşterilerin geçişleri
--      (dükkana geldi / tamamlandı çoğu zaman mağazada başka biri tarafından işaretlenir)
--  pooled/unreachable: üyenin log_call kayıtları
--  new_customers: aralıkta oluşturulan ve üyeye atanmış müşteri
--  assigned: aralıktaki günlük atama satırı (üyenin)
--  by_member: yalnız üyenin satırı
-- ---------------------------------------------------------------------------
create or replace function public._report_range(p_tenant uuid, p_member uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_end timestamptz;
  v_tz constant text := 'Europe/Istanbul';
  v_result jsonb;
begin
  if p_tenant is null then
    raise exception 'Raporları görme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Tarih aralığı geçersiz.' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Rapor aralığı en fazla 366 gün olabilir.' using errcode = '22023';
  end if;
  if p_member is not null
     and not exists (select 1 from public.members x where x.id = p_member and x.tenant_id = p_tenant) then
    raise exception 'Bu çalışanın raporunu görme yetkiniz yok.' using errcode = '42501';
  end if;

  v_start := public.tr_day_start(p_from);
  v_end := public.tr_day_start(p_to + 1);

  with
  att as materialized (
    select a.customer_id, a.member_id, a.outcome,
           (a.created_at at time zone v_tz)::date as dy,
           a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified') as is_reached
    from public.call_attempts a
    where a.tenant_id = p_tenant and a.created_at >= v_start and a.created_at < v_end
      and (p_member is null or a.member_id = p_member)
  ),
  pe as materialized (
    select e.customer_id, e.member_id, e.stage
    from public.pipeline_events e
    where e.tenant_id = p_tenant and e.created_at >= v_start and e.created_at < v_end
      and (p_member is null
           or e.member_id = p_member
           or exists (select 1 from public.customers c
                      where c.id = e.customer_id and c.tenant_id = p_tenant and c.assigned_to = p_member)
           or exists (select 1 from public.call_attempts a2
                      where a2.customer_id = e.customer_id and a2.tenant_id = p_tenant and a2.member_id = p_member))
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
    where l.tenant_id = p_tenant and l.action = 'log_call'
      and l.created_at >= v_start and l.created_at < v_end
      and (p_member is null or l.member_id = p_member)
  ),
  t as (
    select
      (select count(*) from att)::int as attempts,
      (select count(distinct customer_id) from att)::int as customers_called,
      (select count(*) from att where is_reached)::int as reached,
      (select count(*) from att where outcome = 'appointment')::int as appointments,
      (select count(*) from att where outcome = 'disqualified')::int as disqualified,
      (select count(*) from public.customers c
        where c.tenant_id = p_tenant and c.created_at >= v_start and c.created_at < v_end
          and (p_member is null or c.assigned_to = p_member))::int as new_customers,
      (select count(*) from public.daily_assignments d
        where d.tenant_id = p_tenant and d.day between p_from and p_to
          and (p_member is null or d.member_id = p_member))::int as assigned
  ),
  att_m as (
    select member_id,
      count(*)::int as attempts,
      count(*) filter (where is_reached)::int as reached,
      count(*) filter (where outcome = 'appointment')::int as appointments
    from att group by member_id
  ),
  pe_m as (
    select member_id,
      count(distinct customer_id) filter (where stage = 'completed')::int as completed
    from pe group by member_id
  ),
  bm as (
    select mm.id as member_id, mm.full_name,
      coalesce(am.attempts, 0) as attempts,
      coalesce(am.reached, 0) as reached,
      coalesce(am.appointments, 0) as appointments,
      coalesce(pm.completed, 0) as completed
    from public.members mm
    left join att_m am on am.member_id = mm.id
    left join pe_m pm on pm.member_id = mm.id
    where mm.tenant_id = p_tenant
      and (case when p_member is null
                then (mm.is_active and mm.role = 'agent') or am.member_id is not null or pm.member_id is not null
                else mm.id = p_member end)
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
  att_c as (
    select customer_id, count(*) filter (where outcome = 'appointment')::int as appts
    from att group by customer_id
  ),
  pe_c as (
    select distinct customer_id from pe where stage = 'completed'
  ),
  cs as (
    select c.id,
      coalesce(nullif(btrim(c.source_detail), ''), 'Belirtilmemiş') as src,
      coalesce(c.operator, 'Bilinmiyor') as op,
      ac.customer_id is not null as called,
      pc.customer_id is not null as completed,
      coalesce(ac.appts, 0) as appts
    from public.customers c
    left join att_c ac on ac.customer_id = c.id
    left join pe_c pc on pc.customer_id = c.id
    where c.tenant_id = p_tenant
      and (ac.customer_id is not null or pc.customer_id is not null)
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
    'scope', case when p_member is null then 'team' else 'member' end,
    'member_id', p_member,
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
      'new_customers', t.new_customers,
      'assigned', t.assigned
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
-- report_range: kapsam çağırana göre (yönetici/view_reports ekip, diğerleri kendisi)
-- ---------------------------------------------------------------------------
create or replace function public.report_range(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if m.role = 'manager' or public._has_perm(m, 'view_reports') then
    return public._report_range(m.tenant_id, null, p_from, p_to);
  end if;
  return public._report_range(m.tenant_id, m.id, p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- report_range_member: tek çalışanın kapsamı. Yetkisiz çalışan yalnız kendisi.
-- ---------------------------------------------------------------------------
create or replace function public.report_range_member(p_from date, p_to date, p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if p_member is null then
    raise exception 'Çalışan seçilmedi.' using errcode = '22023';
  end if;
  if p_member <> m.id and not (m.role = 'manager' or public._has_perm(m, 'view_reports')) then
    raise exception 'Bu çalışanın raporunu görme yetkiniz yok.' using errcode = '42501';
  end if;
  return public._report_range(m.tenant_id, p_member, p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- day_summary: yönetici, view_team veya view_reports (gövde 20261004000400_rpc.sql ile aynı)
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(
  p_day date default (now() at time zone 'Europe/Istanbul')::date
)
returns table (member_id uuid, full_name text, assigned int, done int, reached int, appointments int, retries int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
  v_day date := coalesce(p_day, public.tr_today());
  v_start timestamptz := public.tr_day_start(coalesce(p_day, public.tr_today()));
  v_end timestamptz := public.tr_day_start(coalesce(p_day, public.tr_today()) + 1);
begin
  if not (m.role = 'manager' or public._has_perm(m, 'view_team') or public._has_perm(m, 'view_reports')) then
    raise exception 'Ekip özetini görme yetkiniz yok.' using errcode = '42501';
  end if;

  return query
    select
      mm.id,
      mm.full_name,
      (select count(*) from public.daily_assignments d
        where d.member_id = mm.id and d.day = v_day)::int,
      (select count(*) from public.daily_assignments d
        join public.customers c on c.id = d.customer_id
        where d.member_id = mm.id and d.day = v_day
          and not (c.call_status in ('pending', 'retry') and c.next_call_at < v_end))::int,
      (select count(distinct a.customer_id) from public.call_attempts a
        where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
          and a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified'))::int,
      (select count(*) from public.call_attempts a
        where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
          and a.outcome = 'appointment')::int,
      (select count(*) from public.daily_assignments d
        join public.customers c on c.id = d.customer_id
        where d.member_id = mm.id and d.day = v_day and c.call_status = 'retry')::int
    from public.members mm
    where mm.tenant_id = m.tenant_id
      and ((mm.is_active and mm.role = 'agent')
           or exists (select 1 from public.daily_assignments d where d.member_id = mm.id and d.day = v_day))
    order by mm.full_name, mm.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- daily_assignments: başkalarının atamaları yalnız yönetici veya view_team
-- ---------------------------------------------------------------------------
drop policy if exists daily_assignments_select on public.daily_assignments;
create policy daily_assignments_select on public.daily_assignments
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (
      (select public.auth_is_manager())
      or (select public.auth_has_perm('view_team'))
      or member_id = (select public.auth_member_id())
    )
  );

-- ---------------------------------------------------------------------------
-- EXECUTE yetkileri
-- ---------------------------------------------------------------------------
revoke execute on function public._report_range(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public._report_range(uuid, uuid, date, date) to service_role;

revoke execute on function
  public.report_range(date, date),
  public.report_range_member(date, date, uuid),
  public.day_summary(date)
from public, anon;

grant execute on function
  public.report_range(date, date),
  public.report_range_member(date, date, uuid),
  public.day_summary(date)
to authenticated;
