-- Dağıtım modları (2026-10-05): free_pool ve manual gerçekten çalışır.
-- auto_even: davranış değişmez.
-- free_pool: sabah yeni müşteri dağıtılmaz; satışçı claim_next ile en eski bekleyeni alır (claim_limit sınırı).
-- manual: sabah yeni müşteri dağıtılmaz; yönetici reassign_customers ile atar (atanan bugünün listesine düşer).
-- Her iki modda: sahibi olan açık (pending/retry) müşteri vakti gelince sahibinin bugünkü listesine konur;
-- süresi dolan havuz müşterisi sahipsiz bekleyene döner (free_pool: Sıradakini al kuyruğu, manual: yöneticiye).

alter table public.tenant_settings
  add column claim_limit smallint not null default 3
    check (claim_limit between 1 and 50);

-- ---------------------------------------------------------------------------
-- _distribute_day_for: auto_even gövdesi 20261004000700_review_fixes.sql ile aynı.
-- free_pool / manual: yalnız sahibine yerleştirme ve havuz dönüşü.
-- ---------------------------------------------------------------------------
create or replace function public._distribute_day_for(p_tenant uuid, p_day date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.tenant_settings;
  v_end timestamptz;
  v_is_today boolean;
  v_ids uuid[];
  v_load int[] := '{}';
  v_pos int[] := '{}';
  v_n int;
  v_cnt int;
  v_max int;
  v_idx int;
  v_p int;
  i int;
  r record;
  v_count int := 0;
  v_pool int := 0;
begin
  if p_tenant is null or p_day is null then
    raise exception 'Dağıtım için kiracı ve gün zorunludur.' using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = p_tenant;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı.' using errcode = 'P0002';
  end if;
  if s.distribution_mode not in ('auto_even', 'free_pool', 'manual') then
    return 0;
  end if;

  -- Aynı kiracı için eşzamanlı dağıtımları sırala
  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(p_tenant::text));

  v_end := public.tr_day_start(p_day + 1);
  v_is_today := p_day = public.tr_today();

  if s.distribution_mode <> 'auto_even' then
    -- Süresi dolan havuz müşterisi sahipsiz bekleyene döner (kuyruk / yönetici ataması)
    update public.customers
    set call_status = 'pending', assigned_to = null, attempts_in_round = 0, updated_at = now()
    where tenant_id = p_tenant and call_status = 'pool' and next_call_at < v_end;
    get diagnostics v_pool = row_count;

    if v_is_today then
      update public.customers c
      set assigned_to = d.member_id, updated_at = now()
      from public.daily_assignments d
      where d.customer_id = c.id and d.day = p_day and d.tenant_id = p_tenant
        and c.tenant_id = p_tenant and c.assigned_to is distinct from d.member_id;
    end if;

    -- Sahibi olan, vakti gelen açık müşteri sahibinin listesine (sahip aktif ve o gün izinli değilse)
    for r in
      select c.id, c.assigned_to
      from public.customers c
      join public.members mm on mm.id = c.assigned_to and mm.tenant_id = c.tenant_id
      where c.tenant_id = p_tenant
        and c.call_status in ('pending', 'retry')
        and c.consent
        and c.next_call_at < v_end
        and mm.is_active and mm.absent_on is distinct from p_day
        and not exists (
          select 1 from public.daily_assignments d where d.day = p_day and d.customer_id = c.id
        )
      order by
        (c.call_status = 'retry') desc,
        case when c.call_status = 'retry' then c.next_call_at end asc nulls last,
        coalesce(c.applied_at, c.created_at) asc,
        c.id
      for update of c
    loop
      select coalesce(max(d.position), 0) + 1 into v_p
      from public.daily_assignments d
      where d.tenant_id = p_tenant and d.day = p_day and d.member_id = r.assigned_to;

      insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
      values (p_tenant, p_day, r.id, r.assigned_to, v_p);
      v_count := v_count + 1;
    end loop;

    -- Zamanlanmış çağrı 5 dakikada bir gelir: yalnız iş yapıldıysa audit yazılır
    if v_count > 0 or v_pool > 0 then
      perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
        jsonb_build_object('day', p_day, 'assigned', v_count, 'pool_returned', v_pool,
                           'mode', s.distribution_mode));
    end if;
    return v_count;
  end if;

  -- auto_even ------------------------------------------------------------------

  -- Süresi dolan havuz müşterileri tekrar aranacaklara döner
  update public.customers
  set call_status = 'retry', updated_at = now()
  where tenant_id = p_tenant and call_status = 'pool' and next_call_at < v_end;
  get diagnostics v_pool = row_count;

  -- Bugünkü atama satırları ile assigned_to tutarlı olsun (ileri tarihli dağıtımdan kalan farklar)
  if v_is_today then
    update public.customers c
    set assigned_to = d.member_id, updated_at = now()
    from public.daily_assignments d
    where d.customer_id = c.id and d.day = p_day and d.tenant_id = p_tenant
      and c.tenant_id = p_tenant and c.assigned_to is distinct from d.member_id;
  end if;

  select array_agg(x.id order by x.full_name, x.id) into v_ids
  from public._recipients(p_tenant, p_day, null) x;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
      jsonb_build_object('day', p_day, 'assigned', 0, 'pool_returned', v_pool, 'reason', 'alıcı yok'));
    return 0;
  end if;

  for i in 1 .. v_n loop
    select count(*)::int, coalesce(max(d.position), 0) into v_cnt, v_max
    from public.daily_assignments d
    where d.tenant_id = p_tenant and d.day = p_day and d.member_id = v_ids[i];
    v_load := v_load || v_cnt;
    v_pos := v_pos || v_max;
  end loop;

  for r in
    select c.id, c.call_status, c.assigned_to
    from public.customers c
    where c.tenant_id = p_tenant
      and c.call_status in ('pending', 'retry')
      and c.consent
      and c.next_call_at < v_end
      and not exists (
        select 1 from public.daily_assignments d where d.day = p_day and d.customer_id = c.id
      )
    order by
      (c.call_status = 'retry') desc,
      case when c.call_status = 'retry' then c.next_call_at end asc nulls last,
      coalesce(c.applied_at, c.created_at) asc,
      c.id
    for update of c
  loop
    v_idx := null;
    if r.call_status = 'retry' and r.assigned_to is not null then
      v_idx := array_position(v_ids, r.assigned_to);
    end if;
    if v_idx is null then
      v_idx := 1;
      for i in 2 .. v_n loop
        if v_load[i] < v_load[v_idx] then
          v_idx := i;
        end if;
      end loop;
    end if;

    v_load[v_idx] := v_load[v_idx] + 1;
    v_pos[v_idx] := v_pos[v_idx] + 1;

    insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
    values (p_tenant, p_day, r.id, v_ids[v_idx], v_pos[v_idx]);

    -- assigned_to yalnız bugünün dağıtımında değişir; ileri gün bugünkü işi koparmaz
    if v_is_today and r.assigned_to is distinct from v_ids[v_idx] then
      update public.customers set assigned_to = v_ids[v_idx], updated_at = now() where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
    jsonb_build_object('day', p_day, 'assigned', v_count, 'pool_returned', v_pool));
  return v_count;
end;
$$;

revoke execute on function public._distribute_day_for(uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _scheduled_distribution_at: auto_even günde bir kez (bugün ataması yokken, eskisi gibi);
-- free_pool / manual dağıtım saatinden sonra her çağrıda (idempotent: yalnız eksik sahip
-- satırlarını ve havuz dönüşünü yapar). Sahibin satırı claim_next ile erken oluşabildiği için
-- bu modlarda "bugün atama yok" koşulu kullanılmaz.
-- ---------------------------------------------------------------------------
create or replace function public._scheduled_distribution_at(p_now timestamptz)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Istanbul';
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
  v_total int := 0;
  t record;
begin
  for t in
    select s.tenant_id from public.tenant_settings s
    where v_local::time >= make_time(s.distribution_hour, s.distribution_minute, 0)
      and (
        (s.distribution_mode = 'auto_even'
         and not exists (select 1 from public.daily_assignments d
                         where d.tenant_id = s.tenant_id and d.day = v_day))
        or s.distribution_mode in ('free_pool', 'manual')
      )
  loop
    v_total := v_total + public._distribute_day_for(t.tenant_id, v_day);
  end loop;
  return v_total;
end;
$$;

revoke execute on function public._scheduled_distribution_at(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _open_claim_count: üyenin bugünkü listesinde vakti gelmiş açık (pending/retry) müşteri sayısı
-- ---------------------------------------------------------------------------
create or replace function public._open_claim_count(p_tenant uuid, p_member uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.daily_assignments d
  join public.customers c on c.id = d.customer_id
  where d.tenant_id = p_tenant and d.day = public.tr_today() and d.member_id = p_member
    and c.call_status in ('pending', 'retry') and c.next_call_at <= now()
$$;

revoke execute on function public._open_claim_count(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_next: serbest havuzda sıradaki (en eski) sahipsiz bekleyen müşteriyi çağırana verir.
-- Uygun müşteri yoksa null döner.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next()
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
  v_pos int;
begin
  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if not found or s.distribution_mode <> 'free_pool' then
    raise exception 'Bu mağazada serbest havuz kapalı.' using errcode = '22023';
  end if;
  if m.absent_on is not distinct from v_today then
    raise exception 'Bugün izinli olarak işaretlisiniz, müşteri alamazsınız.' using errcode = '22023';
  end if;

  -- Dağıtım, aktarım ve havuzdan almayla aynı kilit: sınır kontrolü ve sıra numarası tutarlı kalır
  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  if public._open_claim_count(m.tenant_id, m.id) >= s.claim_limit then
    raise exception 'Aynı anda en fazla % açık müşterin olabilir. Listendekileri arayınca yenisini alabilirsin.',
      s.claim_limit using errcode = '22023';
  end if;

  -- Süresi dolan havuz müşterisi kuyruğa döner (sabah dağıtımını beklemeden)
  update public.customers
  set call_status = 'pending', assigned_to = null, attempts_in_round = 0, updated_at = now()
  where tenant_id = m.tenant_id and call_status = 'pool' and next_call_at <= now();

  select * into c from public.customers x
  where x.tenant_id = m.tenant_id
    and x.assigned_to is null
    and x.call_status = 'pending'
    and x.consent
    and x.next_call_at <= now()
  order by x.next_call_at asc, x.created_at asc, x.id
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;

  update public.customers set assigned_to = m.id, updated_at = now()
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

  perform public._audit(m.tenant_id, m.id, 'claim_next', 'customer', c.id, '{}'::jsonb);
  return c;
end;
$$;

revoke execute on function public.claim_next() from public, anon;
grant execute on function public.claim_next() to authenticated;

-- ---------------------------------------------------------------------------
-- claim_queue_status: Bugün ekranındaki "Sıradaki müşteriyi al" kartı için sayılar (telefon yok)
-- ---------------------------------------------------------------------------
create or replace function public.claim_queue_status()
returns table (mode text, waiting int, open_count int, claim_limit int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
  s public.tenant_settings;
begin
  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  return query
  select s.distribution_mode,
         (select count(*)::int from public.customers x
          where x.tenant_id = m.tenant_id and x.consent and x.next_call_at <= now()
            and ((x.assigned_to is null and x.call_status = 'pending') or x.call_status = 'pool')),
         public._open_claim_count(m.tenant_id, m.id),
         s.claim_limit::int;
end;
$$;

revoke execute on function public.claim_queue_status() from public, anon;
grant execute on function public.claim_queue_status() to authenticated;

-- ---------------------------------------------------------------------------
-- take_from_pool: gövde 20261005000800_shared_pool.sql ile aynı; free_pool'da açık müşteri
-- sınırı (claim_limit) burada da geçerli.
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

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

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

  if s.tenant_id is not null and s.distribution_mode = 'free_pool'
     and public._open_claim_count(m.tenant_id, m.id) >= s.claim_limit then
    raise exception 'Aynı anda en fazla % açık müşterin olabilir. Listendekileri arayınca yenisini alabilirsin.',
      s.claim_limit using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- _reassign_core: gövde 20261005000600_bulk_transfer.sql ile aynı. free_pool / manual'da
-- vakti gelmiş açık müşteri bugün kimsenin listesinde değilse alıcının listesinin sonuna eklenir
-- (auto_even'da sabah dağıtımı yapar; erken satır günlük dağıtımı atlatırdı).
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
  v_mode text;
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
  else
    select s.distribution_mode into v_mode from public.tenant_settings s where s.tenant_id = p_actor.tenant_id;
    if v_mode in ('free_pool', 'manual')
       and c.call_status in ('pending', 'retry') and c.consent
       and c.next_call_at < public.tr_day_start(v_today + 1)
       and p_target.absent_on is distinct from v_today
       and not exists (select 1 from public.daily_assignments d
                       where d.customer_id = c.id and d.day = v_today) then
      select coalesce(max(d.position), 0) + 1 into v_pos
      from public.daily_assignments d
      where d.tenant_id = p_actor.tenant_id and d.day = v_today and d.member_id = p_target.id;

      insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
      values (p_actor.tenant_id, v_today, c.id, p_target.id, v_pos);
    end if;
  end if;

  perform public._audit(p_actor.tenant_id, p_actor.id, 'reassign_customer', 'customer', c.id,
    jsonb_build_object('from', v_from, 'to', p_target.id));
  return c;
end;
$$;

revoke execute on function public._reassign_core(public.members, uuid, public.members)
  from public, anon, authenticated, service_role;
