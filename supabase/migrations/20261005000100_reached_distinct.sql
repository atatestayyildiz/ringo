-- "Ulaşıldı" her yerde farklı müşteri sayısı (Şef kararı).
-- _report_range: reached = count(distinct customer_id) where is_reached (toplam, üye, gün).
-- reach_rate = reached / customers_called. by_member'a customers_called eklendi.
-- day_summary zaten farklı müşteri sayıyordu; değişmedi.

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
      (select count(distinct customer_id) from att where is_reached)::int as reached,
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
      count(distinct customer_id)::int as customers_called,
      count(distinct customer_id) filter (where is_reached)::int as reached,
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
      coalesce(am.customers_called, 0) as customers_called,
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
      count(distinct a.customer_id) filter (where a.is_reached)::int as reached,
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
      'reach_rate', case when t.customers_called = 0 then 0 else least(1, round(t.reached::numeric / t.customers_called, 4)) end,
      'appointment_rate', case when t.reached = 0 then 0 else least(1, round(t.appointments::numeric / t.reached, 4)) end,
      'visit_rate', case when t.appointments = 0 then 0 else least(1, round(fn.visited::numeric / t.appointments, 4)) end,
      'close_rate', case when t.appointments = 0 then 0 else least(1, round(fn.completed::numeric / t.appointments, 4)) end
    ),
    'by_member', coalesce((select jsonb_agg(jsonb_build_object(
        'member_id', bm.member_id, 'full_name', bm.full_name, 'attempts', bm.attempts,
        'customers_called', bm.customers_called, 'reached', bm.reached, 'appointments', bm.appointments, 'completed', bm.completed)
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

revoke execute on function public._report_range(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public._report_range(uuid, uuid, date, date) to service_role;
