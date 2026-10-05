-- Panel kilidi (spec docs/superpowers/specs/2026-10-05-kilit-ve-acilis-design.md §1).
-- Kilit sunucuda tutulur: members.locked_at doluyken müşteri verisi okunamaz, iş RPC'leri çalışmaz.
-- Düz PIN hiçbir yerde saklanmaz; yalnız bcrypt özeti (extensions.crypt + gen_salt('bf')).

-- ---------------------------------------------------------------------------
-- Kolonlar. İstemciye kolon grant'ı verilmez (members grant'ları kolon bazlı); yalnız RPC.
-- ---------------------------------------------------------------------------
alter table public.members
  add column pin_hash text null,
  add column pin_failed smallint not null default 0
    constraint members_pin_failed_range check (pin_failed between 0 and 5),
  add column auto_lock_minutes smallint not null default 10
    constraint members_auto_lock_minutes_allowed check (auto_lock_minutes in (0, 5, 10, 15, 30)),
  add column locked_at timestamptz null;

revoke select (pin_hash, pin_failed, auto_lock_minutes, locked_at),
       insert (pin_hash, pin_failed, auto_lock_minutes, locked_at),
       update (pin_hash, pin_failed, auto_lock_minutes, locked_at)
  on table public.members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Kilit kontrolü
-- ---------------------------------------------------------------------------
-- RLS için tek satırlık stable kontrol (politikada (select ...) ile sorgu başına bir kez hesaplanır).
create or replace function public.auth_unlocked()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.members where user_id = auth.uid() and is_active and locked_at is null) $$;

revoke execute on function public.auth_unlocked() from public, anon;
grant execute on function public.auth_unlocked() to authenticated;

-- İç yardımcı: çağıranın paneli kilitliyse 42501.
create or replace function public._assert_unlocked()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.members where user_id = auth.uid() and is_active and locked_at is not null) then
    raise exception 'Panel kilitli.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._assert_unlocked() from public, anon, authenticated;

-- İş RPC'lerinin tamamı çağıranı current_member() ile çözer: kilit kontrolü buraya eklenir
-- (gövde 20261001000100_init ile aynı, yalnız _assert_unlocked çağrısı eklendi).
create or replace function public.current_member()
returns public.members
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
begin
  select * into m from public.members where user_id = auth.uid() and is_active;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  perform public._assert_unlocked();
  return m;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: müşteri verisi select politikaları. Mevcut koşullar birebir korunur, kilit koşulu eklenir.
-- ---------------------------------------------------------------------------
drop policy customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and ((select public.auth_is_manager())
         or (select public.auth_has_perm('view_all_customers'))
         or (assigned_to = (select public.auth_member_id()) and public.auth_assigned_today(id)))
    and (select public.auth_unlocked())
  );

drop policy daily_assignments_select on public.daily_assignments;
create policy daily_assignments_select on public.daily_assignments
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and ((select public.auth_is_manager())
         or (select public.auth_has_perm('view_team'))
         or member_id = (select public.auth_member_id()))
    and (select public.auth_unlocked())
  );

drop policy call_attempts_select on public.call_attempts;
create policy call_attempts_select on public.call_attempts
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and public.auth_can_view_customer(customer_id)
    and (select public.auth_unlocked())
  );

drop policy pipeline_events_select on public.pipeline_events;
create policy pipeline_events_select on public.pipeline_events
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and public.auth_can_view_customer(customer_id)
    and (select public.auth_unlocked())
  );

-- ---------------------------------------------------------------------------
-- PIN kuralları
-- ---------------------------------------------------------------------------
-- Zayıf PIN: tek rakam tekrarı (111111), ikili/üçlü tekrar (121212, 123123),
-- ardışık artan/azalan (123456, 654321, 890123 gibi 0-9 döngüsü dahil).
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
  if p ~ '^(\d)\1{5}$' or p ~ '^(\d\d)\1\1$' or p ~ '^(\d{3})\1$' then
    return true;
  end if;
  for i in 1..5 loop
    d := (substr(p, i + 1, 1)::int - substr(p, i, 1)::int + 10) % 10;
    if d <> 1 then up := false; end if;
    if d <> 9 then down := false; end if;
  end loop;
  return up or down;
end;
$$;

revoke execute on function public._pin_is_weak(text) from public, anon, authenticated;

-- PIN belirle / değiştir. İlk belirlemede mevcut PIN gerekmez; varsa doğru olmalı ve panel açık olmalı.
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
  if p_new is null or p_new !~ '^\d{6}$' then
    raise exception 'PIN 6 haneli bir sayı olmalı.' using errcode = '22023';
  end if;
  if public._pin_is_weak(p_new) then
    raise exception 'Bu PIN kolay tahmin edilir. Tekrarlanan ya da sıralı rakamlardan oluşmayan bir PIN seçin.'
      using errcode = '22023';
  end if;
  if m.pin_hash is not null then
    if m.locked_at is not null then
      raise exception 'Panel kilitli.' using errcode = '42501';
    end if;
    if p_current_pin is null or p_current_pin !~ '^\d{6}$'
       or extensions.crypt(p_current_pin, m.pin_hash) <> m.pin_hash then
      raise exception 'Mevcut PIN hatalı.' using errcode = '22023';
    end if;
  end if;
  update public.members
  set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
      pin_failed = 0
  where id = m.id;
end;
$$;

revoke execute on function public.set_my_pin(text, text) from public, anon;
grant execute on function public.set_my_pin(text, text) to authenticated;

-- Paneli kilitle. PIN yoksa kilitlenemez (açılamayacak kilit olmasın).
create or replace function public.lock_me()
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
  if m.pin_hash is null then
    raise exception 'Önce bir PIN belirleyin.' using errcode = '22023';
  end if;
  update public.members set locked_at = coalesce(locked_at, now()) where id = m.id;
end;
$$;

revoke execute on function public.lock_me() from public, anon;
grant execute on function public.lock_me() to authenticated;

-- PIN ile aç. 5. yanlışta signed_out: oturum kapatılmalı, e-posta + şifre gerekir.
-- Sayaç 5'te kalır ve bu oturumdan yeni deneme kabul edilmez (istemci oturumu kapatmasa bile
-- REST üzerinden sınırsız deneme olmasın); clear_my_lock (taze şifreli giriş) sıfırlar.
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
  if p_pin is not null and p_pin ~ '^\d{6}$' and extensions.crypt(p_pin, m.pin_hash) = m.pin_hash then
    update public.members set locked_at = null, pin_failed = 0 where id = m.id;
    return jsonb_build_object('ok', true, 'remaining', 5, 'signed_out', false);
  end if;
  failed := m.pin_failed + 1;
  update public.members set pin_failed = failed where id = m.id;
  return jsonb_build_object('ok', false, 'remaining', greatest(5 - failed, 0), 'signed_out', failed >= 5);
end;
$$;

revoke execute on function public.unlock_with_pin(text) from public, anon;
grant execute on function public.unlock_with_pin(text) to authenticated;

-- Durum: aktif üyelik yoksa null (proxy tek çağrıyla üyelik + kilit + PIN durumunu öğrenir).
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
    'auto_lock_minutes', m.auto_lock_minutes)
  from public.members m
  where m.user_id = auth.uid() and m.is_active
$$;

revoke execute on function public.lock_status() from public, anon;
grant execute on function public.lock_status() to authenticated;

create or replace function public.set_my_auto_lock(p_minutes integer)
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
  update public.members set auto_lock_minutes = p_minutes where id = m.id;
end;
$$;

revoke execute on function public.set_my_auto_lock(integer) from public, anon;
grant execute on function public.set_my_auto_lock(integer) to authenticated;

-- E-posta + şifre ile girişte kilidi kaldırır. Yalnız kilitten SONRA açılmış oturum (taze şifreli giriş)
-- kaldırabilir; kilitli eski oturum bu RPC ile PIN'i atlayamaz.
create or replace function public.clear_my_lock()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
  sid uuid;
  born timestamptz;
begin
  select * into m from public.members where user_id = auth.uid() and is_active for update;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  if m.locked_at is null and m.pin_failed = 0 then
    return;
  end if;
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    sid := null;
  end;
  select s.created_at into born from auth.sessions s where s.id = sid and s.user_id = auth.uid();
  if born is null or (m.locked_at is not null and born <= m.locked_at) then
    raise exception 'Kilit yalnız yeni bir girişle kaldırılabilir.' using errcode = '42501';
  end if;
  update public.members set locked_at = null, pin_failed = 0 where id = m.id;
end;
$$;

revoke execute on function public.clear_my_lock() from public, anon;
grant execute on function public.clear_my_lock() to authenticated;
