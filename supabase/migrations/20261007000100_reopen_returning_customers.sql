-- Geri dönen müşteri: kapanmış (done / unreachable / disqualified) kaydın telefonu, kayıttaki son
-- işlemden SONRA doldurulmuş bir formla (applied_at) yeniden gelirse müşteri yeniden aranacaklara
-- alınır. Aynı dosyayı iki kez yüklemek zararsızdır: yeniden açma updated_at'i ilerletir, ikinci
-- yüklemede applied_at artık daha eski kalır. applied_at yoksa (elle ekleme) eski davranış: mükerrer.
-- Randevusu bugün ya da ileri tarihte olan müşteri yeniden açılmaz.
-- Dönüş: yeni alan `reopened`; `duplicates` yalnız atlananları sayar.
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
  c record;
  v_name text;
  v_phone text;
  v_alt text;
  v_birth date;
  v_applied timestamptz;
  v_note text;
  v_new uuid;
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

    v_name := nullif(btrim(r.v ->> 'full_name'), '');
    if v_name is null then
      v_invalid := v_invalid + 1;
      v_invalid_rows := v_invalid_rows || jsonb_build_object('index', r.idx, 'reason', 'Ad soyad boş');
      continue;
    end if;

    v_phone := public.normalize_tr_phone(r.v ->> 'phone');
    if v_phone is null then
      v_invalid := v_invalid + 1;
      v_invalid_rows := v_invalid_rows || jsonb_build_object('index', r.idx, 'reason', 'Telefon numarası geçersiz');
      continue;
    end if;

    v_alt := public.normalize_tr_phone(r.v ->> 'phone_alt');

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

    v_note := nullif(btrim(r.v ->> 'note'), '');

    v_new := null;
    insert into public.customers (
      tenant_id, full_name, phone, phone_alt, operator, birth_date,
      source, source_detail, applied_at, last_note
    ) values (
      m.tenant_id, v_name, v_phone, v_alt, public._normalize_operator(r.v ->> 'operator'), v_birth,
      'import', nullif(btrim(p_source_detail), ''), v_applied, v_note
    )
    on conflict (tenant_id, phone) do nothing
    returning id into v_new;

    if v_new is not null then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    -- Mevcut kayıt: kapanmışsa ve form son işlemden sonra doldurulduysa yeniden aç
    select id, call_status, appointment_day, updated_at into c
    from public.customers
    where tenant_id = m.tenant_id and phone = v_phone
    for update;

    if found
       and c.call_status in ('done', 'unreachable', 'disqualified')
       and v_applied is not null
       and v_applied <= now()
       and v_applied > c.updated_at
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
        applied_at = v_applied,
        source_detail = coalesce(nullif(btrim(p_source_detail), ''), source_detail),
        operator = coalesce(operator, public._normalize_operator(r.v ->> 'operator')),
        phone_alt = coalesce(phone_alt, v_alt)
      where id = c.id;

      perform public._audit(m.tenant_id, m.id, 'customer_reopen', 'customer', c.id,
        jsonb_build_object('from_status', c.call_status));
      v_reopened := v_reopened + 1;
    else
      v_duplicates := v_duplicates + 1;
    end if;
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
