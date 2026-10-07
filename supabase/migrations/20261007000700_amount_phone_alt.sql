-- Tutar ayrı alan, Meta formundaki ikinci telefon phone_alt'a gider.
-- Önceden ikisi de last_note içinde kalıyordu; her arama notu last_note'u değiştirdiği için kayboluyordu.
-- ingest_meta_lead'e isteğe bağlı p_phone_alt ve p_amount eklenir; eski çağrılar çalışmaya devam eder.

alter table public.customers add column if not exists amount text;

drop function if exists public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text);

create or replace function public.ingest_meta_lead(
  p_tenant uuid,
  p_leadgen_id text,
  p_form_id text,
  p_created_time timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_source_detail text,
  p_operator text default null,
  p_phone_alt text default null,
  p_amount text default null
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
  v_alt text;
  v_amount text := left(nullif(btrim(p_amount), ''), 40);
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

  -- İkinci telefon ana telefonla aynıysa yazılmaz
  v_alt := case
    when public.normalize_tr_phone(p_phone_alt) is not distinct from public.normalize_tr_phone(p_phone) then null
    else p_phone_alt
  end;

  v_res := public._ingest_customer_row(
    p_tenant, null, 'meta_api', p_source_detail,
    p_full_name, p_phone, v_alt, p_operator, null, p_created_time, p_note
  );
  v_customer := (v_res ->> 'customer_id')::uuid;

  if v_amount is not null and v_customer is not null and (v_res ->> 'result') in ('inserted', 'reopened') then
    update public.customers set amount = v_amount where id = v_customer and tenant_id = p_tenant;
  end if;

  update public.meta_leads
  set result = v_res ->> 'result', customer_id = v_customer
  where id = v_row;

  update public.meta_connections set last_lead_at = now() where tenant_id = p_tenant;

  perform public._audit(p_tenant, null, 'meta_lead', 'customer', v_customer,
    jsonb_build_object('result', v_res ->> 'result', 'leadgen_id', v_lead));

  return jsonb_build_object('result', v_res ->> 'result', 'customer_id', v_customer);
end;
$$;

revoke execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text, text, text)
  to service_role;

-- Mevcut Meta kayıtları: nottaki Tutar ve Telefon değerleri alanlara taşınır (not olduğu gibi kalır).
update public.customers c
set amount = coalesce(c.amount, left(btrim((regexp_match(c.last_note, 'tutar: ([^·]+)', 'i'))[1]), 40)),
    phone_alt = coalesce(
      c.phone_alt,
      nullif(public.normalize_tr_phone(btrim((regexp_match(c.last_note, 'telefon(?:no)?: ([0-9 +]+)', 'i'))[1])), c.phone)
    )
where c.source = 'meta_api' and c.last_note is not null;
