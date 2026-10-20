-- Meta başvurusu telefonu geçersiz diye atlanmasın.
-- Formda telefon iki kez soruluyor: Meta'nın telefon sorusu (ana telefon) ülke kodu yanlış seçilince
-- (+1, +49) ya da fazla haneyle geliyor; formun kendi telefon sorusu (ikinci telefon) çoğu zaman doğru.
-- 1. Ana telefon geçersiz, ikinci geçerliyse yer değiştirir.
-- 2. İkisi de geçersizse dar kurtarma: yanlış ülke kodu + 5 ile başlayan 10 hane (yalnız Meta).
-- 3. Önceden "invalid" kalmış başvuru yeniden gelirse (tarama) tekrar işlenir; diğerleri "seen".
-- normalize_tr_phone değişmez (CSV içe aktarma da kullanıyor).

create or replace function public._meta_salvage_phone(p text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  -- +1 5xx xxx xx xx: tek haneli yanlış ülke kodu
  if length(d) = 11 and d ~ '^15[0-9]{9}$' then
    return '0' || right(d, 10);
  end if;
  -- +49 5xx xxx xx xx: iki haneli yanlış ülke kodu (90 değil; +90 ile 12 hane zaten geçerli)
  if length(d) = 12 and left(d, 1) <> '0' and left(d, 2) <> '90' and right(d, 10) ~ '^5[0-9]{9}$' then
    return '0' || right(d, 10);
  end if;
  return null;
end;
$$;

revoke execute on function public._meta_salvage_phone(text) from public, anon, authenticated;

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
  v_main text := public.normalize_tr_phone(p_phone);
  v_second text := public.normalize_tr_phone(p_phone_alt);
  v_phone text;
  v_alt text;
  v_amount text := left(nullif(btrim(p_amount), ''), 40);
begin
  if v_lead is null then
    raise exception 'Başvuru kimliği boş.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.meta_connections where tenant_id = p_tenant) then
    raise exception 'Meta bağlantısı bulunamadı.' using errcode = '22023';
  end if;

  -- Önceden geçersiz sayılan başvuru yeniden işlenir; işlenmiş olan "seen" döner.
  insert into public.meta_leads (tenant_id, leadgen_id, form_id, created_time, result)
  values (p_tenant, v_lead, nullif(btrim(p_form_id), ''), p_created_time, 'invalid')
  on conflict (tenant_id, leadgen_id) do update
    set form_id = coalesce(excluded.form_id, public.meta_leads.form_id),
        created_time = coalesce(excluded.created_time, public.meta_leads.created_time)
    where public.meta_leads.result = 'invalid'
  returning id into v_row;

  if v_row is null then
    return jsonb_build_object('result', 'seen');
  end if;

  if v_main is not null then
    v_phone := v_main;
    v_alt := v_second;
  elsif v_second is not null then
    v_phone := v_second;
    v_alt := null;
  else
    v_phone := coalesce(public._meta_salvage_phone(p_phone), public._meta_salvage_phone(p_phone_alt));
    v_alt := null;
  end if;

  -- İkinci telefon ana telefonla aynıysa yazılmaz
  if v_alt is not distinct from v_phone then
    v_alt := null;
  end if;

  v_res := public._ingest_customer_row(
    p_tenant, null, 'meta_api', p_source_detail,
    p_full_name, coalesce(v_phone, p_phone), v_alt, p_operator, null, p_created_time, p_note
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
