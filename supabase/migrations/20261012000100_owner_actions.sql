-- Sahip işlemleri: huni aşaması, randevu zamanı ve serbest not.
-- Sorun: set_pipeline_stage / set_appointment _can_work kullanıyordu; çalışan yalnız bugünkü
-- listesindeki müşteride işlem yapabiliyordu. Huni ilerlemesi (Geldi, Başvuru...) günler sonra
-- olur; müşterinin sahibi her gün işlem yapabilmeli. log_call bugünkü listeye bağlı kalır.
-- Eski migration dosyaları değişmez. Yeni/yeniden tanımlanan fonksiyonlarda açık revoke/grant.

-- ---------------------------------------------------------------------------
-- _can_manage: yönetici veya müşterinin sahibi (release_customer ile aynı kural)
-- ---------------------------------------------------------------------------
create or replace function public._can_manage(m public.members, c public.customers)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(
    m.id is not null and m.is_active
    and c.tenant_id = m.tenant_id
    and (m.role = 'manager' or c.assigned_to = m.id),
    false)
$$;

revoke execute on function public._can_manage(public.members, public.customers) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_appointment: gövde 20261005000500_appointment_time.sql ile aynı, yetki _can_manage
-- ---------------------------------------------------------------------------
create or replace function public.set_appointment(
  p_customer uuid,
  p_day date default null,
  p_time time default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
begin
  if p_time is not null and p_day is null then
    raise exception 'Randevu saati için önce gün seçin.' using errcode = '22023';
  end if;
  if p_day is not null and p_day < public.tr_today() then
    raise exception 'Randevu günü bugünden önce olamaz.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_manage(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  if c.pipeline_stage is distinct from 'appointment' then
    raise exception 'Randevu zamanı yalnız "Dükkana gelecek" aşamasındaki müşteride değiştirilebilir.'
      using errcode = '22023';
  end if;

  update public.customers set
    appointment_day = p_day,
    appointment_time = p_time,
    updated_at = now()
  where id = c.id
  returning * into c;

  perform public._audit(m.tenant_id, m.id, 'set_appointment', 'customer', c.id,
    jsonb_build_object('appointment_day', p_day, 'appointment_time', p_time));
  return c;
end;
$$;

revoke execute on function public.set_appointment(uuid, date, time) from public, anon;
grant execute on function public.set_appointment(uuid, date, time) to authenticated;

-- ---------------------------------------------------------------------------
-- set_pipeline_stage: gövde 20261005000500_appointment_time.sql ile aynı, yetki _can_manage
-- ---------------------------------------------------------------------------
create or replace function public.set_pipeline_stage(
  p_customer uuid,
  p_stage text,
  p_note text default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_note text := nullif(btrim(p_note), '');
  v_enter_appt boolean;
begin
  if p_stage is null or p_stage not in
     ('appointment', 'visited', 'applied', 'approved', 'rejected', 'completed', 'not_interested') then
    raise exception 'Geçersiz huni aşaması.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_manage(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  v_enter_appt := p_stage = 'appointment' and c.pipeline_stage is distinct from 'appointment';

  update public.customers set
    pipeline_stage = p_stage,
    call_status = case when p_stage in ('completed', 'rejected', 'not_interested') then 'done' else call_status end,
    appointment_day = case when v_enter_appt then null else appointment_day end,
    appointment_time = case when v_enter_appt then null else appointment_time end,
    updated_at = now()
  where id = c.id
  returning * into c;

  insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
  values (m.tenant_id, c.id, m.id, p_stage, v_note);

  perform public._audit(m.tenant_id, m.id, 'set_pipeline_stage', 'customer', c.id,
    jsonb_build_object('stage', p_stage));
  return c;
end;
$$;

revoke execute on function public.set_pipeline_stage(uuid, text, text) from public, anon;
grant execute on function public.set_pipeline_stage(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- customer_notes: arama/aşama dışı serbest not (kapanmış müşteriye de eklenebilir).
-- Ayrı tablo: call_attempts'e yazılsaydı arama sayıları ve raporlar bozulurdu.
-- Yazma yalnız add_customer_note ile; eski notlar değişmez (iz korunur).
-- ---------------------------------------------------------------------------
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  customer_id uuid not null,
  member_id uuid not null,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, member_id) references public.members (tenant_id, id)
);

create index customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);

alter table public.customer_notes enable row level security;

create policy customer_notes_select on public.customer_notes
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and public.auth_can_view_customer(customer_id)
    and (select public.auth_unlocked())
  );

revoke insert, update, delete, truncate on table public.customer_notes from anon, authenticated;

create or replace function public.add_customer_note(p_customer uuid, p_note text)
returns public.customer_notes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_note text := nullif(btrim(p_note), '');
  r public.customer_notes;
begin
  if v_note is null then
    raise exception 'Not boş olamaz.' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'Not en fazla 1000 karakter olabilir.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id;
  if not found or not public._can_manage(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  insert into public.customer_notes (tenant_id, customer_id, member_id, note)
  values (m.tenant_id, c.id, m.id, v_note)
  returning * into r;

  perform public._audit(m.tenant_id, m.id, 'add_customer_note', 'customer', c.id, '{}'::jsonb);
  return r;
end;
$$;

revoke execute on function public.add_customer_note(uuid, text) from public, anon;
grant execute on function public.add_customer_note(uuid, text) to authenticated;
