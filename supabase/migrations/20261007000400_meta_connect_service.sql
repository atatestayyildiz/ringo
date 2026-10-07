-- meta_connect (authenticated, herhangi sayfa kimliği kabul ediyordu) kaldırılır.
-- Yerine yalnız service_role çağırır: sayfa kimliği sunucu ortam değişkeninden gelir,
-- yönetici ve panel kilidi sunucu action'ında meta_status ile doğrulanır.
drop function if exists public.meta_connect(text);

create or replace function public.meta_connect_for(p_tenant uuid, p_page_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page text := btrim(p_page_id);
begin
  if p_tenant is null or not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'Hesap bulunamadı.' using errcode = '22023';
  end if;
  if v_page is null or v_page !~ '^[0-9]{5,30}$' then
    raise exception 'Sayfa kimliği geçersiz. Yalnız rakamlardan oluşmalı.' using errcode = '22023';
  end if;

  begin
    insert into public.meta_connections (tenant_id, page_id, connected_at)
    values (p_tenant, v_page, now())
    on conflict (tenant_id) do update set
      page_id = excluded.page_id,
      connected_at = now(),
      last_error = null,
      last_error_at = null;
  exception when unique_violation then
    raise exception 'Bu sayfa başka bir hesaba bağlı.' using errcode = '23505';
  end;

  perform public._audit(p_tenant, null, 'meta_connect', 'tenant', p_tenant,
    jsonb_build_object('page_id', v_page));
end;
$$;

revoke execute on function public.meta_connect_for(uuid, text) from public, anon, authenticated;
grant execute on function public.meta_connect_for(uuid, text) to service_role;
