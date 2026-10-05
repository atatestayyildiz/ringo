-- D3 düzeltmesi: take_from_pool sınırı açık müşteri sayısı değil günlük alma sayısı (otomatik dağıtımda listeler büyük olur).
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

  -- Havuzdan toplu çekmeyi önler: kişi başı günlük en fazla 30 alma (audit kaydından sayılır)
  if (select count(*) from public.audit_log
      where member_id = m.id and action = 'take_from_pool' and created_at >= public.tr_day_start(v_today)) >= 30 then
    raise exception 'Bugün havuzdan en fazla 30 müşteri alabilirsin.' using errcode = '22023';
  end if;

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
