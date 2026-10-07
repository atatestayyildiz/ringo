-- report_intake'e kaynak ve operatör kırılımı eklenir: aralıkta gelen ve hiç aranmamış (bekleyen) başvurular.
-- Kaynak performansı ve Operatör tabloları yalnız aranmış müşterileri saydığı için bekleyenler görünmüyordu.
-- İmza aynı; mevcut çağrılar çalışmaya devam eder (yeni anahtarlar eklenir).

create or replace function public.report_intake(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_start timestamptz;
  v_end timestamptz;
  v_open constant text[] := array['pending', 'retry', 'pool'];
  v_result jsonb;
  v_src jsonb;
  v_op jsonb;
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

  select jsonb_build_object(
    'received', count(*) filter (where c.created_at >= v_start and c.created_at < v_end),
    'looked_at', count(*) filter (where c.created_at >= v_start and c.created_at < v_end and called.ok),
    'waiting', count(*) filter (where c.created_at >= v_start and c.created_at < v_end and not called.ok and c.call_status = any (v_open)),
    'waiting_now', count(*) filter (where not called.ok and c.call_status = any (v_open)),
    'waiting_now_unassigned', count(*) filter (where not called.ok and c.call_status = any (v_open) and c.assigned_to is null)
  )
  into v_result
  from public.customers c
  cross join lateral (
    select exists (
      select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id
    ) as ok
  ) called
  where c.tenant_id = m.tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object('source_detail', x.k, 'received', x.received, 'waiting', x.waiting)
                            order by x.received desc, x.k), '[]'::jsonb)
  into v_src
  from (
    select coalesce(nullif(btrim(c.source_detail), ''), 'Belirtilmemiş') as k,
           count(*)::int as received,
           count(*) filter (where c.call_status = any (v_open)
                            and not exists (select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id))::int as waiting
    from public.customers c
    where c.tenant_id = m.tenant_id and c.created_at >= v_start and c.created_at < v_end
    group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('operator', x.k, 'received', x.received, 'waiting', x.waiting)
                            order by x.received desc, x.k), '[]'::jsonb)
  into v_op
  from (
    select coalesce(c.operator, 'Bilinmiyor') as k,
           count(*)::int as received,
           count(*) filter (where c.call_status = any (v_open)
                            and not exists (select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id))::int as waiting
    from public.customers c
    where c.tenant_id = m.tenant_id and c.created_at >= v_start and c.created_at < v_end
    group by 1
  ) x;

  return v_result || jsonb_build_object('by_source', v_src, 'by_operator', v_op);
end;
$$;

revoke execute on function public.report_intake(date, date) from public, anon;
grant execute on function public.report_intake(date, date) to authenticated;
