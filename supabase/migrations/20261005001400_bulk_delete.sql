-- Toplu müşteri silme: delete_customers. Tekil mantık ortak iç fonksiyona çıkarıldı.

-- ---------------------------------------------------------------------------
-- _delete_customer_core: tek müşteriyi siler (yetki kontrolü çağıranda, görünürlük burada).
-- Audit'te ad baş harfleri ve telefonun son 4 hanesi; silmede tek audit satırı.
-- ---------------------------------------------------------------------------
create or replace function public._delete_customer_core(p_actor public.members, p_customer uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.customers;
  v_digits text;
begin
  select * into c from public.customers
  where id = p_customer and tenant_id = p_actor.tenant_id
  for update;
  if not found or not (p_actor.role = 'manager' or public._can_view(p_actor, c)) then
    raise exception 'Müşteri bulunamadı veya bu müşteriyi görme yetkiniz yok.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(c.phone, ''), '\D', '', 'g');
  perform public._audit(p_actor.tenant_id, p_actor.id, 'customer_deleted', 'customer', c.id,
    jsonb_build_object(
      'initials', public._name_initials(c.full_name),
      'phone', '•••• ' || right(v_digits, 4),
      'reason', nullif(btrim(p_reason), '')
    ));

  -- Tetikleyici bu silme için ikinci (boş) audit satırı yazmasın
  perform set_config('telefoncu.audited_delete', c.id::text, true);
  delete from public.customers where id = c.id;
  perform set_config('telefoncu.audited_delete', '', true);
end;
$$;

revoke execute on function public._delete_customer_core(public.members, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.delete_customer(p_customer uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if not (m.role = 'manager' or public._has_perm(m, 'delete_customers')) then
    raise exception 'Müşteri silme yetkiniz yok.' using errcode = '42501';
  end if;

  perform public._delete_customer_core(m, p_customer, p_reason);
end;
$$;

revoke execute on function public.delete_customer(uuid, text) from public, anon;
grant execute on function public.delete_customer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_customers: toplu silme (tek transaction; biri reddedilirse hepsi geri alınır)
-- ---------------------------------------------------------------------------
create or replace function public.delete_customers(p_customers uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_ids uuid[];
  v_id uuid;
  v_n int := 0;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'delete_customers')) then
    raise exception 'Müşteri silme yetkiniz yok.' using errcode = '42501';
  end if;

  select coalesce(array_agg(x order by x), '{}') into v_ids
  from (select distinct x from unnest(p_customers) x where x is not null) s;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Silinecek müşteri seçilmedi.' using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 500 then
    raise exception 'Tek seferde en fazla 500 müşteri silinebilir.' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    perform public._delete_customer_core(m, v_id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.delete_customers(uuid[]) from public, anon;
grant execute on function public.delete_customers(uuid[]) to authenticated;
