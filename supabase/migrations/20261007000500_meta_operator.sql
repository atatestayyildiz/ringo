-- Meta başvurusundaki operatör sorusu müşterinin Operatör alanına yazılır (önceden yalnız notta kalıyordu).
-- ingest_meta_lead'e isteğe bağlı p_operator eklenir; eski 8 parametreli çağrılar çalışmaya devam eder.
-- Eski imza düşürülür: iki aşırı yükleme adlandırılmış çağrıda belirsizlik yaratır.

drop function if exists public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text);

create or replace function public.ingest_meta_lead(
  p_tenant uuid,
  p_leadgen_id text,
  p_form_id text,
  p_created_time timestamptz,
  p_full_name text,
  p_phone text,
  p_note text,
  p_source_detail text,
  p_operator text default null
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
    p_full_name, p_phone, null, p_operator, null, p_created_time, p_note
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

revoke execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text)
  to service_role;
