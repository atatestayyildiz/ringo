-- Müşteri silme yalnız RPC ile: audit_log'a maskeli kayıt düşer (KVKK: tam veri logda kalmaz).

drop policy if exists customers_delete on public.customers;
-- Politika yok + RLS açık: doğrudan DELETE hata vermez, 0 satır etkiler.

create or replace function public.delete_customer(p_customer uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_digits text;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'delete_customers')) then
    raise exception 'Müşteri silme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found then
    raise exception 'Müşteri bulunamadı.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(c.phone, ''), '\D', '', 'g');
  perform public._audit(m.tenant_id, m.id, 'customer_deleted', 'customer', c.id,
    jsonb_build_object(
      'full_name', c.full_name,
      'phone', '•••• ' || right(v_digits, 4),
      'reason', nullif(btrim(p_reason), '')
    ));

  delete from public.customers where id = c.id;
end;
$$;

revoke execute on function public.delete_customer(uuid, text) from public, anon;
grant execute on function public.delete_customer(uuid, text) to authenticated;
