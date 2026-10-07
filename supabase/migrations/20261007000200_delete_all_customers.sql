-- Tüm müşterileri tek seferde silme (yalnız yönetici). Koruma: çağıran, ekranda gördüğü toplam sayıyı
-- p_expected olarak geçirir; gerçek sayıyla uyuşmazsa (arada müşteri eklendi/silindi) işlem reddedilir.
-- Tek audit satırı yazılır (sayı); satır başına audit satırı basılmaz.

-- Tetikleyici: telefoncu.audited_delete = '*' ise bu transaction'daki silmeler zaten kayıtlıdır.
create or replace function public.tg_customers_audit_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v text := coalesce(current_setting('telefoncu.audited_delete', true), '');
begin
  if v = '*' or v = old.id::text then
    return old;
  end if;
  perform public._audit(old.tenant_id, public.auth_member_id(), 'customer_delete', 'customer', old.id, '{}'::jsonb);
  return old;
end;
$$;

create or replace function public.delete_all_customers(p_expected int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_n int;
begin
  if m.role <> 'manager' then
    raise exception 'Tüm müşterileri yalnız yönetici silebilir.' using errcode = '42501';
  end if;

  select count(*) into v_n from public.customers where tenant_id = m.tenant_id;
  if v_n = 0 then
    raise exception 'Silinecek müşteri yok.' using errcode = '22023';
  end if;
  if p_expected is null or p_expected <> v_n then
    raise exception 'Müşteri sayısı değişti. Sayfayı yenileyip tekrar deneyin.' using errcode = '22023';
  end if;

  perform public._audit(m.tenant_id, m.id, 'customers_delete_all', 'customer', null,
    jsonb_build_object('count', v_n));

  perform set_config('telefoncu.audited_delete', '*', true);
  delete from public.customers where tenant_id = m.tenant_id;
  perform set_config('telefoncu.audited_delete', '', true);
  return v_n;
end;
$$;

revoke execute on function public.delete_all_customers(int) from public, anon;
grant execute on function public.delete_all_customers(int) to authenticated;
