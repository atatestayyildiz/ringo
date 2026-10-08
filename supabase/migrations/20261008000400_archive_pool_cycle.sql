-- Geçmiş dönem düzeltmeleri (20261008000300_archive_calls.sql üzerine):
--  * Telefon maskelenmez: liste tam numarayı gösterir, 4+ haneli aramada numaraya da bakılır.
--  * Alınan müşteri normal döngüye girer: 3 başarısız denemede havuza düşer (7 gün), dönünce yeniden aranır;
--    havuz sayacı alırken sıfırlanır. Müşteri havuzdayken ve dönünce de eski müşteri olarak işaretli kalır.
--  * İşaretli (revive_active) müşteri yeniden kapanırsa tekrar listelenebilir: işaret uygunluğu engellemez.
--    (İşaret yalnız yeni form başvurusunda düşer.)

create or replace function public._archive_eligible(c public.customers)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select c.consent
    and c.updated_at < now() - interval '1 day'
    and (
      c.call_status in ('disqualified', 'unreachable')
      or (c.call_status = 'done' and c.pipeline_stage in ('not_interested', 'rejected'))
    )
$$;

revoke execute on function public._archive_eligible(public.customers) from public, anon, authenticated;

create or replace function public.archive_list(
  p_q text default null,
  p_outcome text default null,
  p_from date default null,
  p_to date default null,
  p_operator text default null,
  p_sort text default 'recent',
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_pat text;
  v_digits text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_from timestamptz := case when p_from is null then null else public.tr_day_start(p_from) end;
  v_to timestamptz := case when p_to is null then null else public.tr_day_start(p_to + 1) end;
  v_total int;
  v_rows jsonb;
begin
  if not public.auth_unlocked() then
    raise exception 'Panel kilitli.' using errcode = '42501';
  end if;
  if p_sort is null or p_sort not in ('recent', 'oldest', 'name') then
    raise exception 'Geçersiz sıralama.' using errcode = '22023';
  end if;
  if v_q is not null then
    v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
    if length(v_digits) < 4 then v_digits := ''; end if;
    v_pat := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with f as materialized (
    select c.*
    from public.customers c
    where c.tenant_id = m.tenant_id
      and public._archive_eligible(c)
      and (p_outcome is null or c.last_outcome = p_outcome)
      and (p_operator is null or (p_operator = 'yok' and c.operator is null) or c.operator = p_operator)
      and (v_from is null or c.updated_at >= v_from)
      and (v_to is null or c.updated_at < v_to)
      and (v_pat is null
           or c.full_name ilike v_pat
           or (v_digits <> '' and c.phone like '%' || v_digits || '%')
           or c.last_note ilike v_pat
           or exists (select 1 from public.call_attempts a
                      where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.note ilike v_pat))
  )
  select
    (select count(*)::int from f),
    (select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
     from (
       select
         row_number() over (
           order by
             case when p_sort = 'recent' then f.updated_at end desc,
             case when p_sort = 'oldest' then f.updated_at end asc,
             case when p_sort = 'name' then f.full_name end asc,
             f.id) as ord,
         jsonb_build_object(
           'id', f.id,
           'full_name', f.full_name,
           'phone', f.phone,
           'operator', f.operator,
           'amount', f.amount,
           'call_status', f.call_status,
           'pipeline_stage', f.pipeline_stage,
           'last_outcome', f.last_outcome,
           'last_note', f.last_note,
           'closed_at', f.updated_at,
           'applied_at', f.applied_at,
           'created_at', f.created_at,
           'call_count', (select count(*) from public.call_attempts a where a.tenant_id = f.tenant_id and a.customer_id = f.id),
           'last_caller', (select mm.full_name from public.call_attempts a
                           join public.members mm on mm.id = a.member_id
                           where a.tenant_id = f.tenant_id and a.customer_id = f.id
                           order by a.created_at desc limit 1),
           'revived_before', f.revived_at is not null
         ) as j
       from f
       order by 1
       offset v_offset limit v_limit
     ) x)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;


revoke execute on function public.archive_list(text, text, date, date, text, text, int, int) from public, anon;
grant execute on function public.archive_list(text, text, date, date, text, text, int, int) to authenticated;

create or replace function public.claim_archive_customers(p_customers uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
  c public.customers;
  v_id uuid;
  v_today date := public.tr_today();
  v_pos int;
  v_claimed int := 0;
  v_skipped int := 0;
  v_waiting int;
  v_ids uuid[];
  v_max constant int := 10;
begin
  if not public.auth_unlocked() then
    raise exception 'Panel kilitli.' using errcode = '42501';
  end if;
  if p_customers is null or coalesce(array_length(p_customers, 1), 0) = 0 then
    raise exception 'Müşteri seçilmedi.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_customers) as x;
  if array_length(v_ids, 1) > v_max then
    raise exception 'Tek seferde en fazla % müşteri alabilirsin.', v_max using errcode = '22023';
  end if;
  if m.absent_on is not distinct from v_today then
    raise exception 'Bugün izinli olarak işaretlisiniz, müşteri alamazsınız.' using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı. Yöneticinize başvurun.' using errcode = 'P0002';
  end if;

  -- Dağıtım ve diğer alma işlemleriyle aynı kilit: sıra numarası tutarlı kalır
  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  select count(*)::int into v_waiting
  from public.customers x
  where x.tenant_id = m.tenant_id and x.assigned_to = m.id and x.revive_active and x.call_status = 'pending';
  if v_waiting + array_length(v_ids, 1) > v_max then
    raise exception 'Aynı anda en fazla % bekleyen geçmiş dönem müşterin olabilir (şu an %). Önce onları ara.',
      v_max, v_waiting using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    select * into c from public.customers x
    where x.id = v_id and x.tenant_id = m.tenant_id
    for update skip locked;
    if not found or not public._archive_eligible(c) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.customers set
      call_status = 'pending',
      pipeline_stage = null,
      assigned_to = m.id,
      attempts_in_round = 0,
      pool_count = 0,
      next_call_at = now(),
      appointment_day = null,
      appointment_time = null,
      revive_active = true,
      revived_at = now(),
      revived_by = m.id,
      updated_at = now()
    where id = c.id;

    select coalesce(max(d.position), 0) + 1 into v_pos
    from public.daily_assignments d
    where d.tenant_id = m.tenant_id and d.day = v_today and d.member_id = m.id;

    insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
    values (m.tenant_id, v_today, c.id, m.id, v_pos)
    on conflict (day, customer_id) do update
      set member_id = excluded.member_id, position = excluded.position;

    perform public._audit(m.tenant_id, m.id, 'archive_claim', 'customer', c.id, '{}'::jsonb);
    v_claimed := v_claimed + 1;
  end loop;

  return jsonb_build_object('claimed', v_claimed, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.claim_archive_customers(uuid[]) from public, anon;
grant execute on function public.claim_archive_customers(uuid[]) to authenticated;
