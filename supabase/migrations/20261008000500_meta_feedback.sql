-- Meta başvuru durum geribeslemesi (docs/spec-meta-geribesleme.md).
-- CRM'de Meta başvurusunun durumu değişince bir olay kuyruğa yazılır; sunucu göndericisi (meta-sync sonunda)
-- olayları Meta Conversions API'ye iletir. Olay üretimi burada (iş kuralı DB'de), aşama adı eşlemesi sunucu kodunda.

-- ---------------------------------------------------------------------------
-- Kuyruk tablosu: RLS açık, politika yok. Yalnız service role ve security definer fonksiyonlar erişir.
-- ---------------------------------------------------------------------------
create table public.meta_feedback_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  leadgen_id text not null,
  customer_id uuid,
  signal text not null
    check (signal in ('lead', 'appointment', 'visited', 'applied', 'approved', 'completed',
                      'rejected', 'not_interested', 'disqualified', 'unreachable')),
  event_time timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, leadgen_id, signal)
);

create index meta_feedback_pending_idx on public.meta_feedback_events (created_at) where status = 'pending';
create index meta_feedback_lead_idx on public.meta_feedback_events (tenant_id, leadgen_id);

alter table public.meta_feedback_events enable row level security;
revoke all on table public.meta_feedback_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sinyal: müşterinin (durum, aşama) çiftinden Meta'ya iletilecek olay türü; yoksa null.
-- ---------------------------------------------------------------------------
create or replace function public._meta_signal(p_status text, p_stage text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_stage in ('appointment', 'visited', 'applied', 'approved', 'completed', 'rejected', 'not_interested') then p_stage
    when p_status = 'disqualified' then 'disqualified'
    when p_status = 'unreachable' then 'unreachable'
    else null
  end
$$;

revoke execute on function public._meta_signal(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tetikleyici 1: yeni Meta başvurusu müşteriye bağlanınca "lead" (Giriş) olayı
-- ---------------------------------------------------------------------------
create or replace function public._meta_feedback_on_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.result in ('inserted', 'reopened') and new.customer_id is not null
     and (tg_op = 'INSERT' or old.result is distinct from new.result) then
    insert into public.meta_feedback_events (tenant_id, leadgen_id, customer_id, signal, event_time)
    values (new.tenant_id, new.leadgen_id, new.customer_id, 'lead', now())
    on conflict (tenant_id, leadgen_id, signal) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public._meta_feedback_on_lead() from public, anon, authenticated;

drop trigger if exists meta_leads_feedback on public.meta_leads;
create trigger meta_leads_feedback
after insert or update of result, customer_id on public.meta_leads
for each row execute function public._meta_feedback_on_lead();

-- ---------------------------------------------------------------------------
-- Tetikleyici 2: müşterinin durumu ya da aşaması değişince yeni sinyal (Meta başvurusu varsa)
-- Geçmiş dönem çalışması (revive_active) olan müşterinin olayları gönderilmez.
-- ---------------------------------------------------------------------------
create or replace function public._meta_feedback_on_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sig text := public._meta_signal(new.call_status, new.pipeline_stage);
  v_lead text;
begin
  if v_sig is null or v_sig is not distinct from public._meta_signal(old.call_status, old.pipeline_stage) then
    return null;
  end if;
  if new.revive_active then
    return null;
  end if;

  select l.leadgen_id into v_lead
  from public.meta_leads l
  where l.tenant_id = new.tenant_id and l.customer_id = new.id and l.result in ('inserted', 'reopened')
  order by l.received_at desc nulls last
  limit 1;
  if v_lead is null then
    return null;
  end if;

  insert into public.meta_feedback_events (tenant_id, leadgen_id, customer_id, signal, event_time)
  values (new.tenant_id, v_lead, new.id, v_sig, now())
  on conflict (tenant_id, leadgen_id, signal) do nothing;
  return null;
end;
$$;

revoke execute on function public._meta_feedback_on_customer() from public, anon, authenticated;

drop trigger if exists customers_meta_feedback on public.customers;
create trigger customers_meta_feedback
after update of call_status, pipeline_stage on public.customers
for each row execute function public._meta_feedback_on_customer();

-- ---------------------------------------------------------------------------
-- Geçmişe dönük: son 6 günde gelen Meta başvurularının "lead" olayı ve mevcut durum sinyali.
-- (Meta event_time'ı en çok 7 gün eski kabul eder ve başvuru zamanından sonra ister.)
-- ---------------------------------------------------------------------------
insert into public.meta_feedback_events (tenant_id, leadgen_id, customer_id, signal, event_time)
select l.tenant_id, l.leadgen_id, l.customer_id, 'lead', l.created_time + interval '1 minute'
from public.meta_leads l
where l.result in ('inserted', 'reopened') and l.customer_id is not null
  and l.created_time is not null and l.created_time > now() - interval '6 days'
on conflict (tenant_id, leadgen_id, signal) do nothing;

insert into public.meta_feedback_events (tenant_id, leadgen_id, customer_id, signal, event_time)
select l.tenant_id, l.leadgen_id, c.id, public._meta_signal(c.call_status, c.pipeline_stage),
       greatest(c.updated_at, l.created_time + interval '2 minutes')
from public.meta_leads l
join public.customers c on c.id = l.customer_id and c.tenant_id = l.tenant_id
where l.result in ('inserted', 'reopened') and l.customer_id is not null
  and l.created_time is not null and l.created_time > now() - interval '6 days'
  and public._meta_signal(c.call_status, c.pipeline_stage) is not null
  and not c.revive_active
on conflict (tenant_id, leadgen_id, signal) do nothing;
