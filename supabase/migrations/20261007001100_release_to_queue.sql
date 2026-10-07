-- Serbest bırakma: serbest havuz ve elle dağıtım modlarında müşteri 'pool' (bekleme) durumuna değil,
-- sahipsiz 'pending' olarak sıraya döner. Böylece "Sıradakini al" kuyruğunda (elle modda yöneticinin
-- atanmamışlar listesinde) hemen görünür, es geçilmez.
-- Otomatik dağıtım modunda eskisi gibi 'pool': Havuz listesinden "Kendime al" ile hemen alınabilir.

create or replace function public.release_customer(p_customer uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  s public.tenant_settings;
  v_today date := public.tr_today();
  v_from uuid;
  v_status text;
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

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  v_status := case when found and s.distribution_mode in ('free_pool', 'manual') then 'pending' else 'pool' end;
  v_from := c.assigned_to;

  update public.customers set
    assigned_to = null,
    call_status = v_status,
    attempts_in_round = 0,
    next_call_at = now(),
    updated_at = now()
  where id = c.id
  returning * into c;

  delete from public.daily_assignments d
  where d.tenant_id = m.tenant_id and d.customer_id = c.id and d.day >= v_today;

  perform public._audit(m.tenant_id, m.id, 'release_customer', 'customer', c.id,
    jsonb_build_object('from', v_from, 'by', m.id, 'to_status', v_status));
  return c;
end;
$$;

revoke execute on function public.release_customer(uuid) from public, anon;
grant execute on function public.release_customer(uuid) to authenticated;
