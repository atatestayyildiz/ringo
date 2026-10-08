-- Kayıp müşteriler (2026-10-08): pasife alınan çalışanın açık müşterileri hiçbir listede görünmüyordu.
-- _distribute_day_for sahibi aktif olmayan müşteriyi atlar, claim_next yalnız sahipsiz 'pending' alır.
--
-- 1. deactivate_member: çalışanı pasifleştirir ve açık (pending/retry) müşterilerini sıraya bırakır.
--    free_pool / manual: sahipsiz 'pending' (claim_next kuyruğu / yöneticinin atanmamışlar listesi).
--    auto_even: yalnız sahiplik boşalır, durum aynı kalır (sabah dağıtımı dengeler).
--    Her iki durumda bugünden itibaren günlük atama satırları silinir.
-- 2. lost_customers: kiracıdaki kayıp açık müşterilerin ayrık kategori sayıları.
-- 3. rescue_lost_customers: owner_inactive ve unowned_retry kategorilerini sıraya bırakır.
-- Sayım ve kurtarma aynı iç fonksiyonu (_lost_customer_rows) kullanır.

-- ---------------------------------------------------------------------------
-- _lost_customer_rows: kayıp açık müşteriler ve kategorileri (bir müşteri tek kategoride).
-- Yalnız consent, pending/retry ve vakti bugün biten müşteriler.
--   owner_inactive: sahibi pasif ya da üye satırı yok
--   owner_absent:   sahibi aktif ve bugün izinli (geçici, bilgi amaçlı)
--   unowned_retry:  free_pool / manual'da sahipsiz 'retry' (claim_next retry almaz)
--   unlisted:       sahibi aktif, bugün izinli değil, bugünün listesinde yok ve dağıtım saati + 15 dk geçti
-- ---------------------------------------------------------------------------
create or replace function public._lost_customer_rows(p_tenant uuid)
returns table (customer_id uuid, category text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with s as (
    select ts.distribution_mode,
           now() >= public.tr_day_start(public.tr_today())
                    + make_interval(hours => ts.distribution_hour, mins => ts.distribution_minute + 15)
             as after_cron
    from public.tenant_settings ts
    where ts.tenant_id = p_tenant
  ),
  x as (
    select c.id,
           case
             when c.assigned_to is null then
               case when c.call_status = 'retry' and s.distribution_mode in ('free_pool', 'manual')
                    then 'unowned_retry' end
             when mm.id is null or not mm.is_active then 'owner_inactive'
             when mm.absent_on is not distinct from public.tr_today() then 'owner_absent'
             when s.after_cron
                  and not exists (select 1 from public.daily_assignments d
                                  where d.tenant_id = p_tenant and d.customer_id = c.id
                                    and d.day = public.tr_today())
               then 'unlisted'
           end as category
    from public.customers c
    cross join s
    left join public.members mm on mm.id = c.assigned_to and mm.tenant_id = c.tenant_id
    where c.tenant_id = p_tenant
      and c.consent
      and c.call_status in ('pending', 'retry')
      and c.next_call_at < public.tr_day_start(public.tr_today() + 1)
  )
  select x.id, x.category from x where x.category is not null
$$;

revoke execute on function public._lost_customer_rows(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _release_to_queue: verilen müşterileri moda göre sıraya bırakır (çağıran kilidi tutar).
-- free_pool / manual: sahipsiz 'pending', tur sayacı 0. next_call_at'e dokunulmaz: vakti gelmiş müşteri
-- zaten claim_next'e uygun, ileri tarihli geri arama tarihinde sıraya girer.
-- auto_even: yalnız sahiplik boşalır.
-- Bugünden itibaren günlük atama satırları silinir. Bırakılan müşteri sayısını döner.
-- ---------------------------------------------------------------------------
create or replace function public._release_to_queue(p_tenant uuid, p_customers uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_count int := 0;
begin
  if p_customers is null or cardinality(p_customers) = 0 then
    return 0;
  end if;

  select s.distribution_mode into v_mode from public.tenant_settings s where s.tenant_id = p_tenant;

  if v_mode in ('free_pool', 'manual') then
    update public.customers set
      assigned_to = null,
      call_status = 'pending',
      attempts_in_round = 0,
      updated_at = now()
    where tenant_id = p_tenant and id = any(p_customers);
  else
    update public.customers set
      assigned_to = null,
      updated_at = now()
    where tenant_id = p_tenant and id = any(p_customers);
  end if;
  get diagnostics v_count = row_count;

  delete from public.daily_assignments d
  where d.tenant_id = p_tenant and d.customer_id = any(p_customers) and d.day >= public.tr_today();

  return v_count;
end;
$$;

revoke execute on function public._release_to_queue(uuid, uuid[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- deactivate_member: yalnız yönetici; çalışanı pasifleştirir, açık müşterilerini sıraya bırakır.
-- Zaten pasif çalışanda da kalan açık müşteriler bırakılır (idempotent).
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_member(p_member uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
  v_ids uuid[];
  v_count int;
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into t from public.members
  where id = p_member and tenant_id = m.tenant_id
  for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = '42501';
  end if;
  if t.id = m.id then
    raise exception 'Kendinizi pasifleştiremezsiniz.' using errcode = '22023';
  end if;

  if t.role = 'manager' and t.is_active then
    -- Eşzamanlı iki pasifleştirmeyi sırala
    perform 1 from public.members
    where tenant_id = m.tenant_id and role = 'manager' and is_active
    for update;
    if not exists (select 1 from public.members
                   where tenant_id = m.tenant_id and role = 'manager' and is_active and id <> t.id) then
      raise exception 'Son aktif yöneticiyi pasifleştiremezsiniz. Önce başka bir yönetici atayın.'
        using errcode = '22023';
    end if;
  end if;

  if t.is_active then
    update public.members set is_active = false where id = t.id;
  end if;

  select array_agg(c.id order by c.id) into v_ids
  from public.customers c
  where c.tenant_id = m.tenant_id and c.assigned_to = t.id and c.call_status in ('pending', 'retry');

  v_count := public._release_to_queue(m.tenant_id, v_ids);

  perform public._audit(m.tenant_id, m.id, 'deactivate_member', 'member', t.id,
    jsonb_build_object('released', v_count, 'was_active', t.is_active));
  return v_count;
end;
$$;

revoke execute on function public.deactivate_member(uuid) from public, anon;
grant execute on function public.deactivate_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lost_customers: yönetici veya view_team. Ayrık kategori sayıları ve toplam.
-- ---------------------------------------------------------------------------
create or replace function public.lost_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v jsonb;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'view_team')) then
    raise exception 'Bu bilgiyi görme yetkiniz yok.' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'total', count(*)::int,
           'owner_inactive', (count(*) filter (where r.category = 'owner_inactive'))::int,
           'owner_absent', (count(*) filter (where r.category = 'owner_absent'))::int,
           'unlisted', (count(*) filter (where r.category = 'unlisted'))::int,
           'unowned_retry', (count(*) filter (where r.category = 'unowned_retry'))::int)
    into v
  from public._lost_customer_rows(m.tenant_id) r;
  return v;
end;
$$;

revoke execute on function public.lost_customers() from public, anon;
grant execute on function public.lost_customers() to authenticated;

-- ---------------------------------------------------------------------------
-- rescue_lost_customers: yalnız yönetici. owner_inactive ve unowned_retry müşterilerini sıraya bırakır.
-- owner_absent ve unlisted'a dokunulmaz.
-- ---------------------------------------------------------------------------
create or replace function public.rescue_lost_customers()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_ids uuid[];
  v_count int;
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select array_agg(r.customer_id order by r.customer_id) into v_ids
  from public._lost_customer_rows(m.tenant_id) r
  where r.category in ('owner_inactive', 'unowned_retry');

  v_count := public._release_to_queue(m.tenant_id, v_ids);

  perform public._audit(m.tenant_id, m.id, 'rescue_lost_customers', 'tenant', m.tenant_id,
    jsonb_build_object('released', v_count));
  return v_count;
end;
$$;

revoke execute on function public.rescue_lost_customers() from public, anon;
grant execute on function public.rescue_lost_customers() to authenticated;
