-- Ortak havuz (2026-10-05): tüm aktif üyeler havuzu görür ve "Kendime al" ile süre dolmadan alabilir.
-- customers SELECT RLS'i genişlemez; havuz listesi sınırlı alanlı security definer RPC'den gelir (telefon yok).

-- ---------------------------------------------------------------------------
-- list_pool: çağıranın kiracısındaki havuz müşterileri (sınırlı alanlar), dönüş tarihine göre sıralı
-- ---------------------------------------------------------------------------
create or replace function public.list_pool()
returns table (
  id uuid,
  full_name text,
  operator text,
  pool_count int,
  next_call_at timestamptz,
  last_member_name text,
  last_outcome text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
begin
  return query
  select c.id, c.full_name, c.operator, c.pool_count, c.next_call_at, a.full_name, c.last_outcome
  from public.customers c
  left join public.members a on a.id = c.assigned_to and a.tenant_id = c.tenant_id
  where c.tenant_id = m.tenant_id and c.call_status = 'pool'
  order by c.next_call_at asc, c.id;
end;
$$;

revoke execute on function public.list_pool() from public, anon;
grant execute on function public.list_pool() to authenticated;

-- ---------------------------------------------------------------------------
-- take_from_pool: aktif üye havuzdaki müşteriyi bugünkü listesine alır
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

  -- Dağıtım ve aktarımlarla aynı kilit: sıra numarası ve atama tutarlı kalır
  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  -- Otomatik dağıtımda bugünün dağıtımı, kiracıda bugün atama yokken yapılır. Havuzdan alınan
  -- kayıt dağıtımdan önce eklenirse günlük dağıtım atlanırdı: zamanı geldiyse önce dağıtım yapılır,
  -- gelmediyse alma reddedilir.
  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if found and s.distribution_mode = 'auto_even'
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

  -- unique (day, customer_id): bugün başka üyeye atanmışsa (aynı gün havuza düştüyse) satır taşınır
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
