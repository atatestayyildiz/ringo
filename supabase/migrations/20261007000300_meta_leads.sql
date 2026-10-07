-- Meta Lead Ads bağlantısı (sözleşme: docs/spec-meta.md, "Veritabanı (Şerit A)").
-- 1. meta_connections / meta_leads tabloları (RLS açık, kişisel veri yok)
-- 2. Ortak satır çekirdeği _ingest_customer_row: import_customers ve ingest_meta_lead aynı kuralı kullanır
--    (telefon normalize, yeni kayıt, kapanmış kaydı yeniden açma, mükerrer). Çağıran üye null olabilir.
-- 3. import_customers çekirdeği çağıracak biçimde yeniden yazılır; davranış ve dönüş alanları aynıdır.
-- 4. Yönetici RPC'leri (meta_connect, meta_status), service_role RPC'leri (meta_tenant_for_page,
--    meta_connections_list, ingest_meta_lead, meta_record_status)
-- 5. Zamanlayıcı: _call_meta_sync + pg_cron 'telefoncu-meta-sync' (20261005001300_notify_via_pg_net kalıbı)

-- ---------------------------------------------------------------------------
-- 1. Tablolar
-- ---------------------------------------------------------------------------
create table public.meta_connections (
  tenant_id uuid primary key references public.tenants on delete cascade,
  page_id text not null unique,
  connected_at timestamptz default now(),
  last_lead_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

alter table public.meta_connections enable row level security;

create policy meta_connections_select on public.meta_connections
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (select public.auth_is_manager())
    and (select public.auth_unlocked())
  );

revoke all on table public.meta_connections from public, anon, authenticated;
grant select on table public.meta_connections to authenticated;

create table public.meta_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  leadgen_id text not null,
  form_id text,
  created_time timestamptz,
  result text not null check (result in ('inserted', 'reopened', 'duplicate', 'invalid')),
  customer_id uuid,
  received_at timestamptz default now(),
  unique (tenant_id, leadgen_id)
);
create index meta_leads_tenant_received_idx on public.meta_leads (tenant_id, received_at desc);

-- Politika yok: yalnız security definer fonksiyonlar okur/yazar.
alter table public.meta_leads enable row level security;
revoke all on table public.meta_leads from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ortak satır çekirdeği (iç fonksiyon; istemci rollerine kapalı)
-- Dönüş: {"result": inserted|reopened|duplicate|invalid, "customer_id": uuid|null, "reason": metin|null}
-- p_member null olabilir (Meta çağrısı kullanıcısızdır); current_member()'a bağımlı değildir.
-- ---------------------------------------------------------------------------
create or replace function public._ingest_customer_row(
  p_tenant uuid,
  p_member uuid,
  p_source text,
  p_source_detail text,
  p_full_name text,
  p_phone text,
  p_phone_alt text,
  p_operator text,
  p_birth_date date,
  p_applied_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'Europe/Istanbul'
as $$
declare
  c record;
  v_name text := nullif(btrim(p_full_name), '');
  v_phone text;
  v_alt text;
  v_note text := nullif(btrim(p_note), '');
  v_detail text := nullif(btrim(p_source_detail), '');
  v_new uuid;
begin
  if v_name is null then
    return jsonb_build_object('result', 'invalid', 'customer_id', null, 'reason', 'Ad soyad boş');
  end if;

  v_phone := public.normalize_tr_phone(p_phone);
  if v_phone is null then
    return jsonb_build_object('result', 'invalid', 'customer_id', null, 'reason', 'Telefon numarası geçersiz');
  end if;

  v_alt := public.normalize_tr_phone(p_phone_alt);

  insert into public.customers (
    tenant_id, full_name, phone, phone_alt, operator, birth_date,
    source, source_detail, applied_at, last_note
  ) values (
    p_tenant, v_name, v_phone, v_alt, public._normalize_operator(p_operator), p_birth_date,
    p_source, v_detail, p_applied_at, v_note
  )
  on conflict (tenant_id, phone) do nothing
  returning id into v_new;

  if v_new is not null then
    return jsonb_build_object('result', 'inserted', 'customer_id', v_new, 'reason', null);
  end if;

  -- Mevcut kayıt: kapanmışsa ve form son işlemden sonra doldurulduysa yeniden aç
  select id, call_status, appointment_day, updated_at into c
  from public.customers
  where tenant_id = p_tenant and phone = v_phone
  for update;

  if found
     and c.call_status in ('done', 'unreachable', 'disqualified')
     and p_applied_at is not null
     and p_applied_at <= now()
     and p_applied_at > c.updated_at
     and (c.appointment_day is null or c.appointment_day < public.tr_today()) then
    update public.customers set
      call_status = 'pending',
      pipeline_stage = null,
      attempts_in_round = 0,
      pool_count = 0,
      next_call_at = now(),
      assigned_to = null,
      appointment_day = null,
      appointment_time = null,
      last_outcome = null,
      last_note = 'Tekrar başvurdu' || coalesce(' · ' || v_note, ''),
      applied_at = p_applied_at,
      source_detail = coalesce(v_detail, source_detail),
      operator = coalesce(operator, public._normalize_operator(p_operator)),
      phone_alt = coalesce(phone_alt, v_alt)
    where id = c.id;

    perform public._audit(p_tenant, p_member, 'customer_reopen', 'customer', c.id,
      jsonb_build_object('from_status', c.call_status));
    return jsonb_build_object('result', 'reopened', 'customer_id', c.id, 'reason', null);
  end if;

  return jsonb_build_object('result', 'duplicate', 'customer_id', c.id, 'reason', null);
end;
$$;

revoke execute on function public._ingest_customer_row(uuid, uuid, text, text, text, text, text, text, date, timestamptz, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. import_customers: girdi ayrıştırma burada, satır kuralı çekirdekte.
-- Gövde 20261007000100_reopen_returning_customers.sql ile aynı davranış.
-- ---------------------------------------------------------------------------
create or replace function public.import_customers(p_rows jsonb, p_source_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'Europe/Istanbul'
as $$
declare
  m public.members := public.current_member();
  r record;
  v_birth date;
  v_applied timestamptz;
  v_res jsonb;
  v_inserted int := 0;
  v_duplicates int := 0;
  v_reopened int := 0;
  v_invalid int := 0;
  v_invalid_rows jsonb := '[]'::jsonb;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'import_customers')) then
    raise exception 'Müşteri içe aktarma yetkiniz yok.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'İçe aktarılacak satırlar liste biçiminde olmalı.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Tek seferde en fazla 5000 satır içe aktarılabilir. Dosyayı bölün.' using errcode = '22023';
  end if;

  for r in
    select e.value as v, (e.ord - 1)::int as idx
    from jsonb_array_elements(p_rows) with ordinality as e(value, ord)
  loop
    if jsonb_typeof(r.v) <> 'object' then
      v_invalid := v_invalid + 1;
      v_invalid_rows := v_invalid_rows || jsonb_build_object('index', r.idx, 'reason', 'Satır biçimi geçersiz');
      continue;
    end if;

    begin
      v_birth := nullif(btrim(r.v ->> 'birth_date'), '')::date;
      if v_birth > public.tr_today() or v_birth < date '1900-01-01' then
        v_birth := null;
      end if;
    exception when others then
      v_birth := null;
    end;

    begin
      v_applied := nullif(btrim(r.v ->> 'applied_at'), '')::timestamptz;
    exception when others then
      v_applied := null;
    end;

    v_res := public._ingest_customer_row(
      m.tenant_id, m.id, 'import', p_source_detail,
      r.v ->> 'full_name', r.v ->> 'phone', r.v ->> 'phone_alt', r.v ->> 'operator',
      v_birth, v_applied, r.v ->> 'note'
    );

    case v_res ->> 'result'
      when 'inserted' then v_inserted := v_inserted + 1;
      when 'reopened' then v_reopened := v_reopened + 1;
      when 'duplicate' then v_duplicates := v_duplicates + 1;
      else
        v_invalid := v_invalid + 1;
        v_invalid_rows := v_invalid_rows || jsonb_build_object('index', r.idx, 'reason', v_res ->> 'reason');
    end case;
  end loop;

  perform public._audit(m.tenant_id, m.id, 'import_customers', 'customer', null,
    jsonb_build_object('source_detail', p_source_detail, 'inserted', v_inserted,
                       'duplicates', v_duplicates, 'reopened', v_reopened, 'invalid', v_invalid));

  return jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'reopened', v_reopened,
    'invalid', v_invalid,
    'invalid_rows', v_invalid_rows
  );
end;
$$;

revoke execute on function public.import_customers(jsonb, text) from public, anon;
grant execute on function public.import_customers(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. Yönetici RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.meta_connect(p_page_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_page text := btrim(p_page_id);
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;
  if v_page is null or v_page !~ '^[0-9]{5,30}$' then
    raise exception 'Sayfa kimliği geçersiz. Yalnız rakamlardan oluşmalı.' using errcode = '22023';
  end if;

  begin
    insert into public.meta_connections (tenant_id, page_id, connected_at)
    values (m.tenant_id, v_page, now())
    on conflict (tenant_id) do update set
      page_id = excluded.page_id,
      connected_at = now(),
      last_error = null,
      last_error_at = null;
  exception when unique_violation then
    raise exception 'Bu sayfa başka bir hesaba bağlı.' using errcode = '23505';
  end;

  perform public._audit(m.tenant_id, m.id, 'meta_connect', 'tenant', m.tenant_id,
    jsonb_build_object('page_id', v_page));
end;
$$;

revoke execute on function public.meta_connect(text) from public, anon;
grant execute on function public.meta_connect(text) to authenticated;

create or replace function public.meta_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.meta_connections;
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;

  select * into c from public.meta_connections where tenant_id = m.tenant_id;
  if not found then
    return jsonb_build_object('connected', false);
  end if;

  return jsonb_build_object(
    'connected', true,
    'page_id', c.page_id,
    'connected_at', c.connected_at,
    'last_lead_at', c.last_lead_at,
    'last_sync_at', c.last_sync_at,
    'last_error', c.last_error,
    'last_error_at', c.last_error_at
  );
end;
$$;

revoke execute on function public.meta_status() from public, anon;
grant execute on function public.meta_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. service_role RPC'leri (webhook ve zamanlayıcı; authenticated/anon kapalı)
-- ---------------------------------------------------------------------------
create or replace function public.meta_tenant_for_page(p_page_id text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.meta_connections where page_id = btrim(p_page_id)
$$;

revoke execute on function public.meta_tenant_for_page(text) from public, anon, authenticated;
grant execute on function public.meta_tenant_for_page(text) to service_role;

create or replace function public.meta_connections_list()
returns table (tenant_id uuid, page_id text, last_sync_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.tenant_id, c.page_id, c.last_sync_at
  from public.meta_connections c
  order by c.connected_at
$$;

revoke execute on function public.meta_connections_list() from public, anon, authenticated;
grant execute on function public.meta_connections_list() to service_role;

-- Idempotent: (tenant, leadgen_id) önce meta_leads'e yazılır; aynı anda gelen ikinci çağrı unique
-- index üzerinde bekler, ilki işlenince 'seen' döner. Ad ve telefon meta_leads/audit'e yazılmaz.
create or replace function public.ingest_meta_lead(
  p_tenant uuid,
  p_leadgen_id text,
  p_form_id text,
  p_created_time timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_source_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead text := nullif(btrim(p_leadgen_id), '');
  v_row uuid;
  v_res jsonb;
  v_customer uuid;
begin
  if v_lead is null then
    raise exception 'Başvuru kimliği boş.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.meta_connections where tenant_id = p_tenant) then
    raise exception 'Meta bağlantısı bulunamadı.' using errcode = '22023';
  end if;

  insert into public.meta_leads (tenant_id, leadgen_id, form_id, created_time, result)
  values (p_tenant, v_lead, nullif(btrim(p_form_id), ''), p_created_time, 'invalid')
  on conflict (tenant_id, leadgen_id) do nothing
  returning id into v_row;

  if v_row is null then
    return jsonb_build_object('result', 'seen');
  end if;

  v_res := public._ingest_customer_row(
    p_tenant, null, 'meta_api', p_source_detail,
    p_full_name, p_phone, null, null, null, p_created_time, p_note
  );
  v_customer := (v_res ->> 'customer_id')::uuid;

  update public.meta_leads
  set result = v_res ->> 'result', customer_id = v_customer
  where id = v_row;

  update public.meta_connections set last_lead_at = now() where tenant_id = p_tenant;

  perform public._audit(p_tenant, null, 'meta_lead', 'customer', v_customer,
    jsonb_build_object('result', v_res ->> 'result', 'leadgen_id', v_lead));

  return jsonb_build_object('result', v_res ->> 'result', 'customer_id', v_customer);
end;
$$;

revoke execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text)
  to service_role;

create or replace function public.meta_record_status(
  p_tenant uuid,
  p_ok boolean,
  p_error text default null,
  p_synced boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.meta_connections set
    last_error = case when p_ok then null else left(coalesce(p_error, 'Bilinmeyen hata'), 300) end,
    last_error_at = case when p_ok then null else now() end,
    last_sync_at = case when p_synced then now() else last_sync_at end
  where tenant_id = p_tenant;
end;
$$;

revoke execute on function public.meta_record_status(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.meta_record_status(uuid, boolean, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Zamanlayıcı: _call_meta_sync (yalnız pg_cron) + iş 'telefoncu-meta-sync'
-- Adres ve sır Vault'tan (app_url, cron_secret); biri yoksa istek yapılmaz.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public._call_meta_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  select btrim(s.decrypted_secret) into v_url
  from vault.decrypted_secrets s
  where s.name = 'app_url'
  order by s.created_at desc
  limit 1;

  select btrim(s.decrypted_secret) into v_secret
  from vault.decrypted_secrets s
  where s.name = 'cron_secret'
  order by s.created_at desc
  limit 1;

  if v_url is null or v_url !~* '^https?://[^\s]+$' or v_secret is null or v_secret = '' then
    return null;
  end if;

  select net.http_post(
    url := regexp_replace(v_url, '/+$', '') || '/api/cron/meta-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$$;

revoke execute on function public._call_meta_sync() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'telefoncu-meta-sync') then
    perform cron.unschedule('telefoncu-meta-sync');
  end if;
end;
$$;

select cron.schedule(
  'telefoncu-meta-sync',
  '*/10 * * * *',
  $$select public._call_meta_sync()$$
);
