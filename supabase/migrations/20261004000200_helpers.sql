-- Yardımcı fonksiyonlar ve tetikleyiciler (spec §5 ilk satır, §2)
-- RLS yardımcıları security definer: members üzerindeki politikalar bunları çağırdığında
-- RLS özyinelemesi oluşmaz (fonksiyon sahibi postgres RLS'e takılmaz).

-- ---------------------------------------------------------------------------
-- Zaman yardımcıları (Europe/Istanbul)
-- ---------------------------------------------------------------------------
create or replace function public.tr_today()
returns date
language sql stable
set search_path = public
as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

create or replace function public.tr_day_start(p_day date)
returns timestamptz
language sql immutable
set search_path = public
as $$ select (p_day::timestamp at time zone 'Europe/Istanbul') $$;

-- ---------------------------------------------------------------------------
-- normalize_tr_phone
-- ---------------------------------------------------------------------------
create or replace function public.normalize_tr_phone(p text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  d text;
begin
  if p is null then
    return null;
  end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if length(d) = 12 and left(d, 2) = '90' then
    d := '0' || right(d, 10);
  elsif length(d) = 10 and left(d, 1) = '5' then
    d := '0' || d;
  end if;
  if d ~ '^05[0-9]{9}$' then
    return d;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Doğum günü yardımcıları (29 Şubat her yıl 28 Şubat sayılır)
-- ---------------------------------------------------------------------------
create or replace function public.birthday_in_year(p_birth date, p_year int)
returns date
language sql immutable
set search_path = public
as $$
  select case
    when p_birth is null or p_year is null then null
    when extract(month from p_birth) = 2 and extract(day from p_birth) = 29 then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from p_birth)::int, extract(day from p_birth)::int)
  end
$$;

create or replace function public.birthday_next(p_birth date, p_from date)
returns date
language sql immutable
set search_path = public
as $$
  select case
    when public.birthday_in_year(p_birth, extract(year from p_from)::int) >= p_from
      then public.birthday_in_year(p_birth, extract(year from p_from)::int)
    else public.birthday_in_year(p_birth, extract(year from p_from)::int + 1)
  end
$$;

-- ---------------------------------------------------------------------------
-- Üyelik / RLS yardımcıları
-- ---------------------------------------------------------------------------
create or replace function public.current_member()
returns public.members
language plpgsql stable security definer
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
  return m;
end;
$$;

create or replace function public.auth_member_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select id from public.members where user_id = auth.uid() and is_active $$;

create or replace function public.auth_tenant_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select tenant_id from public.members where user_id = auth.uid() and is_active $$;

create or replace function public.auth_is_manager()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'manager' from public.members where user_id = auth.uid() and is_active),
    false)
$$;

create or replace function public.auth_has_perm(p_perm text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select permissions -> p_perm = 'true'::jsonb from public.members where user_id = auth.uid() and is_active),
    false)
$$;

-- Çağıran (aktif üye) bu müşteriye bugün atanmış mı?
create or replace function public.auth_assigned_today(p_customer uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.daily_assignments d
    join public.members m on m.id = d.member_id
    where d.customer_id = p_customer
      and d.day = public.tr_today()
      and m.user_id = auth.uid()
      and m.is_active
  )
$$;

-- İç kurallar (fonksiyonlarda kullanılır, istemciye kapalı):
-- _can_work: müşteri üzerinde işlem (arama kaydı, aşama) yapabilir mi?
--   manager veya (assigned_to = üye ve bugün ona atanmış).
-- _can_view: _can_work veya view_all_customers.
-- Hepsi NULL güvenli: eksik anahtar / boş alan her zaman false döner (asla NULL).
create or replace function public._has_perm(m public.members, p_perm text)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(m.id is not null and m.is_active and m.permissions -> p_perm = 'true'::jsonb, false)
$$;

create or replace function public._can_work(m public.members, c public.customers)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(
    m.id is not null and m.is_active
    and c.tenant_id = m.tenant_id
    and (
      m.role = 'manager'
      or (
        c.assigned_to = m.id
        and exists (
          select 1 from public.daily_assignments d
          where d.customer_id = c.id and d.member_id = m.id and d.day = public.tr_today()
        )
      )
    ),
    false)
$$;

create or replace function public._can_view(m public.members, c public.customers)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(
    m.id is not null and m.is_active
    and c.tenant_id = m.tenant_id
    and (public._has_perm(m, 'view_all_customers') or public._can_work(m, c)),
    false)
$$;

create or replace function public.auth_can_view_customer(p_customer uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.customers c
    join public.members m on m.user_id = auth.uid() and m.is_active
    where c.id = p_customer
      and public._can_view(m, c)
  )
$$;

-- ---------------------------------------------------------------------------
-- Denetim kaydı (iç)
-- ---------------------------------------------------------------------------
create or replace function public._audit(
  p_tenant uuid, p_member uuid, p_action text, p_entity text, p_entity_id uuid, p_data jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (tenant_id, member_id, action, entity, entity_id, data)
  values (p_tenant, p_member, p_action, p_entity, p_entity_id, p_data)
$$;

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

-- Yeni kiracıya varsayılan ayar satırı
create or replace function public.tg_tenants_default_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tenant_settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger tenants_default_settings
after insert on public.tenants
for each row execute function public.tg_tenants_default_settings();

-- Müşteri telefonlarını normalize et, updated_at güncelle
create or replace function public.tg_customers_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  v := public.normalize_tr_phone(new.phone);
  if v is null then
    raise exception 'Telefon numarası geçersiz. 05XXXXXXXXX biçiminde 11 hane olmalı.'
      using errcode = '22023';
  end if;
  new.phone := v;

  if new.phone_alt is not null and btrim(new.phone_alt) <> '' then
    v := public.normalize_tr_phone(new.phone_alt);
    if v is null then
      raise exception 'İkinci telefon numarası geçersiz. 05XXXXXXXXX biçiminde 11 hane olmalı.'
        using errcode = '22023';
    end if;
    new.phone_alt := v;
  else
    new.phone_alt := null;
  end if;

  new.full_name := btrim(new.full_name);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger customers_before_write
before insert or update on public.customers
for each row execute function public.tg_customers_before_write();

-- Doğrudan müşteri silmeyi denetim kaydına yaz (KVKK). Kişisel veri yazılmaz.
create or replace function public.tg_customers_audit_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._audit(old.tenant_id, public.auth_member_id(), 'customer_delete', 'customer', old.id, '{}'::jsonb);
  return old;
end;
$$;

create trigger customers_audit_delete
after delete on public.customers
for each row execute function public.tg_customers_audit_delete();
