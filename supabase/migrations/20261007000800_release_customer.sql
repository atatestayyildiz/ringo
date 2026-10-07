-- Serbest bırakma: kendi müşterisini havuza geri verir, herkes alabilir.
-- Müşteri 'pool' durumuna döner (vakti hemen gelmiş): serbest havuz modunda "Sıradakini al" kuyruğuna,
-- diğer modlarda Havuz listesine düşer. Bugünkü ve gelecek günlük atama satırı silinir.
-- Yalnız açık (pending/retry) müşteri bırakılır; çalışan yalnız kendi müşterisini, yönetici herkesinkini.

create or replace function public.release_customer(p_customer uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_today date := public.tr_today();
  v_from uuid;
begin
  if m.id is null or not m.is_active then
    raise exception 'Bu işlem için aktif bir çalışan olmalısınız.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found then
    raise exception 'Müşteri bulunamadı.' using errcode = '42501';
  end if;

  if c.assigned_to is distinct from m.id and m.role <> 'manager' then
    raise exception 'Bu müşteri size atanmış değil.' using errcode = '42501';
  end if;
  if c.assigned_to is null then
    raise exception 'Bu müşteri zaten kimseye atanmamış.' using errcode = '22023';
  end if;
  if c.call_status not in ('pending', 'retry') then
    raise exception 'Yalnız açık müşteri serbest bırakılabilir.' using errcode = '22023';
  end if;

  v_from := c.assigned_to;

  update public.customers set
    assigned_to = null,
    call_status = 'pool',
    attempts_in_round = 0,
    next_call_at = now(),
    updated_at = now()
  where id = c.id
  returning * into c;

  delete from public.daily_assignments d
  where d.tenant_id = m.tenant_id and d.customer_id = c.id and d.day >= v_today;

  perform public._audit(m.tenant_id, m.id, 'release_customer', 'customer', c.id,
    jsonb_build_object('from', v_from, 'by', m.id));
  return c;
end;
$$;

revoke execute on function public.release_customer(uuid) from public, anon;
grant execute on function public.release_customer(uuid) to authenticated;
