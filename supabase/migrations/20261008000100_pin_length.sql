-- PIN uzunluğu 4-8 hane arasında serbest. Kilit ekranı kullanıcının PIN'i kaç haneliyse o kadar daire çizsin
-- diye hane sayısı members.pin_length'te tutulur (hash'ten çıkarılamaz). Mevcut PIN'ler 6 haneli: varsayılan 6.
-- Kolon istemciye doğrudan açılmaz; yalnız lock_status() ve set_my_pin() RPC'leri.

alter table public.members
  add column pin_length smallint not null default 6
    constraint members_pin_length_range check (pin_length between 4 and 8);

revoke select (pin_length), insert (pin_length), update (pin_length)
  on table public.members from anon, authenticated;

-- Zayıf PIN (4-8 hane): tek rakam tekrarı (1111, 000000), blok tekrarı (1212, 123123, 12341234),
-- ardışık artan/azalan (1234, 4321, 567890, 890123 gibi 0-9 döngüsü dahil).
create or replace function public._pin_is_weak(p text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  i int;
  up boolean := true;
  down boolean := true;
  d int;
begin
  if p ~ '^(\d)\1+$' or p ~ '^(\d{2,4})\1+$' then
    return true;
  end if;
  for i in 1..length(p) - 1 loop
    d := (substr(p, i + 1, 1)::int - substr(p, i, 1)::int + 10) % 10;
    if d <> 1 then up := false; end if;
    if d <> 9 then down := false; end if;
  end loop;
  return up or down;
end;
$$;

revoke execute on function public._pin_is_weak(text) from public, anon, authenticated;

create or replace function public.set_my_pin(p_new text, p_current_pin text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
begin
  select * into m from public.members where user_id = auth.uid() and is_active for update;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  if p_new is null or p_new !~ '^\d{4,8}$' then
    raise exception 'PIN 4 ile 8 hane arasında bir sayı olmalı.' using errcode = '22023';
  end if;
  if public._pin_is_weak(p_new) then
    raise exception 'Bu PIN kolay tahmin edilir. Tekrarlanan ya da sıralı rakamlardan oluşmayan bir PIN seçin.'
      using errcode = '22023';
  end if;
  if m.pin_hash is not null then
    if m.locked_at is not null then
      raise exception 'Panel kilitli.' using errcode = '42501';
    end if;
    if p_current_pin is null or p_current_pin !~ '^\d{4,8}$'
       or extensions.crypt(p_current_pin, m.pin_hash) <> m.pin_hash then
      raise exception 'Mevcut PIN hatalı.' using errcode = '22023';
    end if;
  end if;
  update public.members
  set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
      pin_length = length(p_new),
      pin_failed = 0
  where id = m.id;
  perform public._audit(m.tenant_id, m.id, case when m.pin_hash is null then 'pin_set' else 'pin_changed' end,
    'member', m.id, '{}'::jsonb);
end;
$$;

revoke execute on function public.set_my_pin(text, text) from public, anon;
grant execute on function public.set_my_pin(text, text) to authenticated;

create or replace function public.unlock_with_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
  failed int;
begin
  select * into m from public.members where user_id = auth.uid() and is_active for update;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  if m.locked_at is null then
    return jsonb_build_object('ok', true, 'remaining', 5, 'signed_out', false);
  end if;
  if m.pin_hash is null then
    raise exception 'Önce bir PIN belirleyin.' using errcode = '22023';
  end if;
  if m.pin_failed >= 5 then
    return jsonb_build_object('ok', false, 'remaining', 0, 'signed_out', true);
  end if;
  if p_pin is not null and p_pin ~ '^\d{4,8}$' and extensions.crypt(p_pin, m.pin_hash) = m.pin_hash then
    update public.members set locked_at = null, pin_failed = 0 where id = m.id;
    return jsonb_build_object('ok', true, 'remaining', 5, 'signed_out', false);
  end if;
  failed := m.pin_failed + 1;
  update public.members set pin_failed = failed where id = m.id;
  if failed >= 5 then
    perform public._audit(m.tenant_id, m.id, 'pin_lockout', 'member', m.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', false, 'remaining', greatest(5 - failed, 0), 'signed_out', failed >= 5);
end;
$$;

revoke execute on function public.unlock_with_pin(text) from public, anon;
grant execute on function public.unlock_with_pin(text) to authenticated;

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
    'pin_length', m.pin_length,
    'auto_lock_minutes', m.auto_lock_minutes,
    'auto_lock_minutes_mobile', m.auto_lock_minutes_mobile)
  from public.members m
  where m.user_id = auth.uid() and m.is_active
$$;

revoke execute on function public.lock_status() from public, anon;
grant execute on function public.lock_status() to authenticated;

-- Müşteri listesi canlı yenileme (Realtime): yeni/değişen müşteri satırı açık panellere RLS kurallarıyla iletilir.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers') then
    alter publication supabase_realtime add table public.customers;
  end if;
end $$;
