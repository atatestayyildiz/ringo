-- Toplu aktarım: reassign_customers, transfer_open_work. Ortak mantık iç fonksiyonlarda.

-- ---------------------------------------------------------------------------
-- _reassign_core: tek müşteriyi hedef üyeye taşır (yetki ve hedef doğrulaması çağıranda).
-- ---------------------------------------------------------------------------
create or replace function public._reassign_core(p_actor public.members, p_customer uuid, p_target public.members)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.customers;
  v_today date := public.tr_today();
  v_pos int;
  v_from uuid;
begin
  select * into c from public.customers
  where id = p_customer and tenant_id = p_actor.tenant_id
  for update;
  if not found or not public._can_view(p_actor, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteriyi görme yetkiniz yok.' using errcode = '42501';
  end if;

  v_from := c.assigned_to;

  update public.customers set assigned_to = p_target.id, updated_at = now()
  where id = c.id
  returning * into c;

  if exists (select 1 from public.daily_assignments d
             where d.customer_id = c.id and d.day = v_today and d.member_id <> p_target.id) then
    select coalesce(max(d.position), 0) + 1 into v_pos
    from public.daily_assignments d
    where d.tenant_id = p_actor.tenant_id and d.day = v_today and d.member_id = p_target.id;

    update public.daily_assignments
    set member_id = p_target.id, position = v_pos
    where customer_id = c.id and day = v_today;
  end if;

  perform public._audit(p_actor.tenant_id, p_actor.id, 'reassign_customer', 'customer', c.id,
    jsonb_build_object('from', v_from, 'to', p_target.id));
  return c;
end;
$$;

revoke execute on function public._reassign_core(public.members, uuid, public.members)
  from public, anon, authenticated, service_role;

create or replace function public.reassign_customer(p_customer uuid, p_member uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'reassign')) then
    raise exception 'Müşteri devretme yetkiniz yok.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into t from public.members
  where id = p_member and tenant_id = m.tenant_id and is_active;
  if not found then
    raise exception 'Devredilecek aktif çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  return public._reassign_core(m, p_customer, t);
end;
$$;

-- ---------------------------------------------------------------------------
-- reassign_customers: toplu devir (tek transaction; biri reddedilirse hepsi geri alınır)
-- ---------------------------------------------------------------------------
create or replace function public.reassign_customers(p_customers uuid[], p_member uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
  v_ids uuid[];
  v_id uuid;
  v_n int := 0;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'reassign')) then
    raise exception 'Müşteri devretme yetkiniz yok.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_customers) x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Devredilecek müşteri seçilmedi.' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 500 then
    raise exception 'Tek seferde en fazla 500 müşteri devredilebilir.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into t from public.members
  where id = p_member and tenant_id = m.tenant_id and is_active;
  if not found then
    raise exception 'Devredilecek aktif çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  foreach v_id in array v_ids loop
    perform public._reassign_core(m, v_id, t);
    v_n := v_n + 1;
  end loop;

  perform public._audit(m.tenant_id, m.id, 'reassign_customers', 'member', t.id,
    jsonb_build_object('count', v_n));
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- _move_open_work: kaynağın o günkü açık atamalarını alıcılara en az yüke göre dağıtır.
-- ---------------------------------------------------------------------------
create or replace function public._move_open_work(p_tenant uuid, p_from uuid, p_to uuid[], p_day date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := coalesce(array_length(p_to, 1), 0);
  v_load int[] := '{}';
  v_pos int[] := '{}';
  v_cnt int;
  v_max int;
  v_idx int;
  i int;
  r record;
  v_moved int := 0;
begin
  if v_n = 0 then
    return 0;
  end if;

  for i in 1 .. v_n loop
    select count(*)::int, coalesce(max(d.position), 0) into v_cnt, v_max
    from public.daily_assignments d
    where d.tenant_id = p_tenant and d.day = p_day and d.member_id = p_to[i];
    v_load := v_load || v_cnt;
    v_pos := v_pos || v_max;
  end loop;

  for r in
    select d.id as assignment_id, d.customer_id
    from public.daily_assignments d
    join public.customers c on c.id = d.customer_id
    where d.tenant_id = p_tenant and d.day = p_day and d.member_id = p_from
      and c.call_status in ('pending', 'retry')
    order by d.position
    for update of d
  loop
    v_idx := 1;
    for i in 2 .. v_n loop
      if v_load[i] < v_load[v_idx] then
        v_idx := i;
      end if;
    end loop;
    v_load[v_idx] := v_load[v_idx] + 1;
    v_pos[v_idx] := v_pos[v_idx] + 1;

    update public.daily_assignments
    set member_id = p_to[v_idx], position = v_pos[v_idx]
    where id = r.assignment_id;

    update public.customers
    set assigned_to = p_to[v_idx], updated_at = now()
    where id = r.customer_id and assigned_to is not distinct from p_from;

    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end;
$$;

revoke execute on function public._move_open_work(uuid, uuid, uuid[], date)
  from public, anon, authenticated, service_role;

-- mark_absent: aynı davranış, dağıtım ortak fonksiyondan
create or replace function public.mark_absent(
  p_member uuid,
  p_day date default (now() at time zone 'Europe/Istanbul')::date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
  v_day date := coalesce(p_day, public.tr_today());
  v_ids uuid[];
  v_moved int := 0;
begin
  if m.role <> 'manager' then
    raise exception 'Çalışanı "bugün yok" olarak yalnız yönetici işaretleyebilir.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into t from public.members where id = p_member and tenant_id = m.tenant_id for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  update public.members set absent_on = v_day where id = t.id;

  select array_agg(x.id order by x.full_name, x.id) into v_ids
  from public._recipients(m.tenant_id, v_day, t.id) x;

  v_moved := public._move_open_work(m.tenant_id, t.id, v_ids, v_day);

  perform public._audit(m.tenant_id, m.id, 'mark_absent', 'member', t.id,
    jsonb_build_object('day', v_day, 'moved', v_moved));
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- transfer_open_work: kişiyi izinli işaretlemeden açık işleri aktarır
-- ---------------------------------------------------------------------------
create or replace function public.transfer_open_work(
  p_from uuid,
  p_to uuid default null,
  p_day date default public.tr_today()
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  f public.members;
  t public.members;
  v_day date := coalesce(p_day, public.tr_today());
  v_ids uuid[];
  v_moved int;
begin
  if m.role <> 'manager' then
    raise exception 'İşleri aktarma yetkisi yalnız yöneticidedir.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into f from public.members where id = p_from and tenant_id = m.tenant_id for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  if p_to is not null then
    if p_to = f.id then
      raise exception 'Kaynak ve hedef aynı çalışan olamaz.' using errcode = '22023';
    end if;
    select * into t from public.members
    where id = p_to and tenant_id = m.tenant_id and is_active;
    if not found then
      raise exception 'Aktarılacak aktif çalışan bulunamadı.' using errcode = 'P0002';
    end if;
    v_ids := array[t.id];
  else
    select array_agg(x.id order by x.full_name, x.id) into v_ids
    from public._recipients(m.tenant_id, v_day, f.id) x;
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'İşlerin aktarılacağı başka çalışan yok.' using errcode = '22023';
    end if;
  end if;

  v_moved := public._move_open_work(m.tenant_id, f.id, v_ids, v_day);

  perform public._audit(m.tenant_id, m.id, 'transfer_open_work', 'member', f.id,
    jsonb_build_object('day', v_day, 'to', p_to, 'moved', v_moved));
  return v_moved;
end;
$$;

revoke execute on function public.reassign_customers(uuid[], uuid) from public, anon;
grant execute on function public.reassign_customers(uuid[], uuid) to authenticated;
revoke execute on function public.transfer_open_work(uuid, uuid, date) from public, anon;
grant execute on function public.transfer_open_work(uuid, uuid, date) to authenticated;
