-- Otomatik kilit telefon (dokunmatik) cihazlar için ayrı ayar: açma/kapama ve süre çalışanın kendi seçimi.
-- Telefonda varsayılan kapalı (0); bilgisayardaki mevcut ayar (auto_lock_minutes) aynen kalır.
-- Kolon istemciye açılmaz; yalnız lock_status() ve set_my_auto_lock_mobile() RPC'leri.

alter table public.members
  add column auto_lock_minutes_mobile smallint not null default 0
    constraint members_auto_lock_minutes_mobile_allowed check (auto_lock_minutes_mobile in (0, 5, 10, 15, 30));

revoke select (auto_lock_minutes_mobile),
       insert (auto_lock_minutes_mobile),
       update (auto_lock_minutes_mobile)
  on table public.members from anon, authenticated;

create or replace function public.lock_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'locked', m.locked_at is not null,
    'has_pin', m.pin_hash is not null,
    'auto_lock_minutes', m.auto_lock_minutes,
    'auto_lock_minutes_mobile', m.auto_lock_minutes_mobile)
  from public.members m
  where m.user_id = auth.uid() and m.is_active
$$;

revoke execute on function public.lock_status() from public, anon;
grant execute on function public.lock_status() to authenticated;

create or replace function public.set_my_auto_lock_mobile(p_minutes integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if p_minutes is null or p_minutes not in (0, 5, 10, 15, 30) then
    raise exception 'Geçersiz süre. Listeden bir süre seçin.' using errcode = '22023';
  end if;
  update public.members set auto_lock_minutes_mobile = p_minutes where id = m.id;
end;
$$;

revoke execute on function public.set_my_auto_lock_mobile(integer) from public, anon;
grant execute on function public.set_my_auto_lock_mobile(integer) to authenticated;
