-- Geçmiş dönem müşteri aramaları.
--
-- Kapanmış müşteriler (uygun değil, ulaşılamadı, ilgilenmiyor/reddedildi) aylar sonra filtrelenip çalışanlar
-- tarafından kendilerine atanarak yeniden aranabilir. Bu aramalar bugünkü form müşterisi gibi sayılmaz:
--   * Gelen/bekleyen (report_intake) ve kaynak/operatör performansı yalnız normal müşterileri sayar.
--   * Çalışanın arama, ulaşılan, randevu sayaçlarına (prim) eklenir; ayrıca "archive" bloğunda ayrı raporlanır.
-- İş kuralı yalnız DB'de: listeleme (archive_list), alma (claim_archive_customers), işaretleme (tetikleyiciler).

-- ---------------------------------------------------------------------------
-- Şema
-- ---------------------------------------------------------------------------
-- revive_active: müşteri şu an geçmiş dönem çalışması olarak aranıyor. Yeni bir form başvurusu (applied_at
-- değişimi) müşteriyi normal müşteriye döndürür; bayrak otomatik düşer.
alter table public.customers
  add column revive_active boolean not null default false,
  add column revived_at timestamptz,
  add column revived_by uuid;

-- Aramanın hangi türde yapıldığı arama anında kaydedilir (sonradan bayrak değişse de rapor bozulmaz).
alter table public.call_attempts
  add column archive boolean not null default false;

create or replace function public._call_attempt_set_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.archive := coalesce(
    (select c.revive_active from public.customers c where c.id = new.customer_id and c.tenant_id = new.tenant_id),
    false);
  return new;
end;
$$;

revoke execute on function public._call_attempt_set_archive() from public, anon, authenticated;

drop trigger if exists call_attempts_set_archive on public.call_attempts;
create trigger call_attempts_set_archive
before insert on public.call_attempts
for each row execute function public._call_attempt_set_archive();

create or replace function public._customer_clear_archive_on_new_form()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.revive_active and new.applied_at is distinct from old.applied_at then
    new.revive_active := false;
  end if;
  return new;
end;
$$;

revoke execute on function public._customer_clear_archive_on_new_form() from public, anon, authenticated;

drop trigger if exists customers_clear_archive on public.customers;
create trigger customers_clear_archive
before update on public.customers
for each row execute function public._customer_clear_archive_on_new_form();

-- ---------------------------------------------------------------------------
-- Uygunluk: kapanmış ve yeniden aranabilir müşteri
-- ---------------------------------------------------------------------------
-- Kapalı durumlar: uygun değil, ulaşılamadı, ilgilenmiyor/reddedildi. Randevulu, işlem yapılmış ya da hâlâ
-- aranmakta olan müşteri listede çıkmaz. Son işlemi üzerinden en az 1 gün geçmiş olmalı (aynı gün
-- kapanan müşteri hemen başkasına geçmesin).
create or replace function public._archive_eligible(c public.customers)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select c.consent
    and not c.revive_active
    and c.updated_at < now() - interval '1 day'
    and (
      c.call_status in ('disqualified', 'unreachable')
      or (c.call_status = 'done' and c.pipeline_stage in ('not_interested', 'rejected'))
    )
$$;

revoke execute on function public._archive_eligible(public.customers) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- archive_list: filtreli geçmiş dönem listesi (tüm aktif çalışanlar ve yönetici)
-- ---------------------------------------------------------------------------
-- Telefon maskelidir (ilk 4 ve son 2 hane): liste numara toplamak için kullanılamaz; alınan müşterinin
-- numarası normal akıştan (Bugün) görünür. p_outcome: son arama sonucu (disqualified, not_interested,
-- wrong_number, no_answer, busy...) ya da null. Tarih aralığı son işlem gününe göredir.
-- Döner: { total, rows: [...] }
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
           'phone_hint', left(f.phone, 4) || ' *** ** ' || right(f.phone, 2),
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

-- ---------------------------------------------------------------------------
-- claim_archive_customers: seçilen kapanmış müşterileri çağırana atar ve bugünkü listesine koyar
-- ---------------------------------------------------------------------------
-- Aynı anda en fazla 10 bekleyen (henüz aranmamış) geçmiş dönem müşterisi tutulabilir; toplu stoklama olmaz.
-- Başkası aynı müşteriyi aldıysa o müşteri atlanır (skipped). Müşteri bekleyen olur, deneme sayacı sıfırlanır;
-- havuz hakkı tükenmiş sayılır: 3 başarısız denemeden sonra havuza değil yeniden kapanır ("ulaşılamadı").
-- Serbest havuz sınırına (claim_limit) sayılmaz: yeni form müşterisi almayı engellemez.
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
      pool_count = greatest(pool_count, s.max_rounds),
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

-- ---------------------------------------------------------------------------
-- Serbest havuz sınırı geçmiş dönem müşterisini saymaz (yeni form müşterisi almayı engellemesin)
-- ---------------------------------------------------------------------------
create or replace function public._open_claim_count(p_tenant uuid, p_member uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.daily_assignments d
  join public.customers c on c.id = d.customer_id
  where d.tenant_id = p_tenant and d.day = public.tr_today() and d.member_id = p_member
    and c.call_status in ('pending', 'retry') and c.next_call_at <= now()
    and not (c.call_status = 'retry' and c.last_outcome in ('no_answer', 'busy'))
    and not c.revive_active
$$;

revoke execute on function public._open_claim_count(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- report_intake: geçmiş dönemden alınıp henüz aranmamış müşteri "bekleyen başvuru" sayılmaz
-- ---------------------------------------------------------------------------
create or replace function public.report_intake(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_start timestamptz;
  v_end timestamptz;
  v_open constant text[] := array['pending', 'retry', 'pool'];
  v_result jsonb;
  v_src jsonb;
  v_op jsonb;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'view_reports')) then
    raise exception 'Raporları görme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Tarih aralığı geçersiz.' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Rapor aralığı en fazla 366 gün olabilir.' using errcode = '22023';
  end if;

  v_start := public.tr_day_start(p_from);
  v_end := public.tr_day_start(p_to + 1);

  select jsonb_build_object(
    'received', count(*) filter (where c.created_at >= v_start and c.created_at < v_end),
    'looked_at', count(*) filter (where c.created_at >= v_start and c.created_at < v_end and called.ok),
    'waiting', count(*) filter (where c.created_at >= v_start and c.created_at < v_end and not called.ok and not c.revive_active and c.call_status = any (v_open)),
    'waiting_now', count(*) filter (where not called.ok and not c.revive_active and c.call_status = any (v_open)),
    'waiting_now_unassigned', count(*) filter (where not called.ok and not c.revive_active and c.call_status = any (v_open) and c.assigned_to is null)
  )
  into v_result
  from public.customers c
  cross join lateral (
    select exists (
      select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id
    ) as ok
  ) called
  where c.tenant_id = m.tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object('source_detail', x.k, 'received', x.received, 'waiting', x.waiting)
                            order by x.received desc, x.k), '[]'::jsonb)
  into v_src
  from (
    select coalesce(nullif(btrim(c.source_detail), ''), 'Belirtilmemiş') as k,
           count(*)::int as received,
           count(*) filter (where c.call_status = any (v_open) and not c.revive_active
                            and not exists (select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id))::int as waiting
    from public.customers c
    where c.tenant_id = m.tenant_id and c.created_at >= v_start and c.created_at < v_end
    group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('operator', x.k, 'received', x.received, 'waiting', x.waiting)
                            order by x.received desc, x.k), '[]'::jsonb)
  into v_op
  from (
    select coalesce(c.operator, 'Bilinmiyor') as k,
           count(*)::int as received,
           count(*) filter (where c.call_status = any (v_open) and not c.revive_active
                            and not exists (select 1 from public.call_attempts a where a.tenant_id = c.tenant_id and a.customer_id = c.id))::int as waiting
    from public.customers c
    where c.tenant_id = m.tenant_id and c.created_at >= v_start and c.created_at < v_end
    group by 1
  ) x;

  return v_result || jsonb_build_object('by_source', v_src, 'by_operator', v_op);
end;
$$;

revoke execute on function public.report_intake(date, date) from public, anon;
grant execute on function public.report_intake(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- _report_range: sayaçlar (arama, ulaşılan, randevu) geçmiş dönem aramalarını da içerir (prim);
-- kaynak ve operatör performansı yalnız normal aramaları sayar; ayrıca 'archive' bloğu ayrı raporlar.
-- Gövde 20261005000100_reached_distinct.sql ile aynı; değişiklikler "geçmiş dönem" yorumlu.
-- ---------------------------------------------------------------------------
create or replace function public._report_range(p_tenant uuid, p_member uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_start timestamptz;
  v_end timestamptz;
  v_tz constant text := 'Europe/Istanbul';
  v_result jsonb;
begin
  if p_tenant is null then
    raise exception 'Raporları görme yetkiniz yok.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Tarih aralığı geçersiz.' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Rapor aralığı en fazla 366 gün olabilir.' using errcode = '22023';
  end if;
  if p_member is not null
     and not exists (select 1 from public.members x where x.id = p_member and x.tenant_id = p_tenant) then
    raise exception 'Bu çalışanın raporunu görme yetkiniz yok.' using errcode = '42501';
  end if;

  v_start := public.tr_day_start(p_from);
  v_end := public.tr_day_start(p_to + 1);

  with
  att as materialized (
    select a.customer_id, a.member_id, a.outcome, a.archive,
           (a.created_at at time zone v_tz)::date as dy,
           a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified') as is_reached
    from public.call_attempts a
    where a.tenant_id = p_tenant and a.created_at >= v_start and a.created_at < v_end
      and (p_member is null or a.member_id = p_member)
  ),
  pe as materialized (
    select e.customer_id, e.member_id, e.stage
    from public.pipeline_events e
    where e.tenant_id = p_tenant and e.created_at >= v_start and e.created_at < v_end
      and (p_member is null
           or e.member_id = p_member
           or exists (select 1 from public.customers c
                      where c.id = e.customer_id and c.tenant_id = p_tenant and c.assigned_to = p_member)
           or exists (select 1 from public.call_attempts a2
                      where a2.customer_id = e.customer_id and a2.tenant_id = p_tenant and a2.member_id = p_member))
  ),
  fn as (
    select
      count(distinct customer_id) filter (where stage = 'visited')::int as visited,
      count(distinct customer_id) filter (where stage = 'applied')::int as applied,
      count(distinct customer_id) filter (where stage = 'approved')::int as approved,
      count(distinct customer_id) filter (where stage = 'completed')::int as completed,
      count(distinct customer_id) filter (where stage = 'rejected')::int as rejected,
      count(distinct customer_id) filter (where stage = 'not_interested')::int as not_interested
    from pe
  ),
  au as (
    select
      count(*) filter (where l.data ->> 'call_status' = 'pool')::int as pooled,
      count(*) filter (where l.data ->> 'call_status' = 'unreachable')::int as unreachable
    from public.audit_log l
    where l.tenant_id = p_tenant and l.action = 'log_call'
      and l.created_at >= v_start and l.created_at < v_end
      and (p_member is null or l.member_id = p_member)
  ),
  t as (
    select
      (select count(*) from att)::int as attempts,
      (select count(distinct customer_id) from att)::int as customers_called,
      (select count(distinct customer_id) from att where is_reached)::int as reached,
      (select count(*) from att where outcome = 'appointment')::int as appointments,
      (select count(*) from att where outcome = 'disqualified')::int as disqualified,
      (select count(*) from public.customers c
        where c.tenant_id = p_tenant and c.created_at >= v_start and c.created_at < v_end
          and (p_member is null or c.assigned_to = p_member))::int as new_customers,
      (select count(*) from public.daily_assignments d
        where d.tenant_id = p_tenant and d.day between p_from and p_to
          and (p_member is null or d.member_id = p_member))::int as assigned
  ),
  att_m as (
    select member_id,
      count(*)::int as attempts,
      count(distinct customer_id)::int as customers_called,
      count(distinct customer_id) filter (where is_reached)::int as reached,
      count(*) filter (where outcome = 'appointment')::int as appointments
    from att group by member_id
  ),
  pe_m as (
    select member_id,
      count(distinct customer_id) filter (where stage = 'completed')::int as completed
    from pe group by member_id
  ),
  bm as (
    select mm.id as member_id, mm.full_name,
      coalesce(am.attempts, 0) as attempts,
      coalesce(am.customers_called, 0) as customers_called,
      coalesce(am.reached, 0) as reached,
      coalesce(am.appointments, 0) as appointments,
      coalesce(pm.completed, 0) as completed
    from public.members mm
    left join att_m am on am.member_id = mm.id
    left join pe_m pm on pm.member_id = mm.id
    where mm.tenant_id = p_tenant
      and (case when p_member is null
                then (mm.is_active and mm.role = 'agent') or am.member_id is not null or pm.member_id is not null
                else mm.id = p_member end)
  ),
  bd as (
    select g.d as day,
      count(a.customer_id)::int as attempts,
      count(distinct a.customer_id) filter (where a.is_reached)::int as reached,
      count(a.customer_id) filter (where a.outcome = 'appointment')::int as appointments
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
    left join att a on a.dy = g.d::date
    group by g.d
  ),
  bo as (
    select outcome, count(*)::int as cnt from att group by outcome
  ),
  att_c as (
    -- geçmiş dönem: kaynak ve operatör performansı yalnız normal (bugünkü form) aramalarını sayar
    select customer_id, count(*) filter (where outcome = 'appointment')::int as appts
    from att where not archive group by customer_id
  ),
  pe_c as (
    select distinct customer_id from pe where stage = 'completed'
  ),
  cs as (
    select c.id,
      coalesce(nullif(btrim(c.source_detail), ''), 'Belirtilmemiş') as src,
      coalesce(c.operator, 'Bilinmiyor') as op,
      ac.customer_id is not null as called,
      pc.customer_id is not null as completed,
      coalesce(ac.appts, 0) as appts
    from public.customers c
    left join att_c ac on ac.customer_id = c.id
    left join pe_c pc on pc.customer_id = c.id
    where c.tenant_id = p_tenant
      and (ac.customer_id is not null or pc.customer_id is not null)
  ),
  bs as (
    select src, count(*) filter (where called)::int as customers, sum(appts)::int as appointments,
           count(*) filter (where completed)::int as completed
    from cs group by src
  ),
  bop as (
    select op, count(*) filter (where called)::int as customers,
           count(*) filter (where completed)::int as completed
    from cs group by op
  ),
  -- geçmiş dönem: alınan müşteri sayısı audit kaydından, arama sayaçları arşiv bayraklı aramalardan
  arc_cl as (
    select l.member_id, count(*)::int as claimed
    from public.audit_log l
    where l.tenant_id = p_tenant and l.action = 'archive_claim'
      and l.created_at >= v_start and l.created_at < v_end
      and (p_member is null or l.member_id = p_member)
    group by l.member_id
  ),
  arc_m as (
    select member_id,
      count(*)::int as attempts,
      count(distinct customer_id)::int as customers_called,
      count(distinct customer_id) filter (where is_reached)::int as reached,
      count(*) filter (where outcome = 'appointment')::int as appointments
    from att where archive group by member_id
  ),
  arc_done as (
    select count(distinct pe.customer_id)::int as completed
    from pe
    where pe.stage = 'completed' and exists (select 1 from att a where a.archive and a.customer_id = pe.customer_id)
  ),
  arc_bm as (
    select mm.id as member_id, mm.full_name,
      coalesce(cl.claimed, 0) as claimed,
      coalesce(am.attempts, 0) as attempts,
      coalesce(am.customers_called, 0) as customers_called,
      coalesce(am.reached, 0) as reached,
      coalesce(am.appointments, 0) as appointments
    from public.members mm
    left join arc_cl cl on cl.member_id = mm.id
    left join arc_m am on am.member_id = mm.id
    where mm.tenant_id = p_tenant and (cl.member_id is not null or am.member_id is not null)
  )
  select jsonb_build_object(
    'scope', case when p_member is null then 'team' else 'member' end,
    'member_id', p_member,
    'totals', jsonb_build_object(
      'attempts', t.attempts,
      'customers_called', t.customers_called,
      'reached', t.reached,
      'appointments', t.appointments,
      'visited', fn.visited,
      'applied', fn.applied,
      'approved', fn.approved,
      'completed', fn.completed,
      'rejected', fn.rejected,
      'not_interested', fn.not_interested,
      'disqualified', t.disqualified,
      'pooled', au.pooled,
      'unreachable', au.unreachable,
      'new_customers', t.new_customers,
      'assigned', t.assigned
    ),
    'rates', jsonb_build_object(
      'reach_rate', case when t.customers_called = 0 then 0 else least(1, round(t.reached::numeric / t.customers_called, 4)) end,
      'appointment_rate', case when t.reached = 0 then 0 else least(1, round(t.appointments::numeric / t.reached, 4)) end,
      'visit_rate', case when t.appointments = 0 then 0 else least(1, round(fn.visited::numeric / t.appointments, 4)) end,
      'close_rate', case when t.appointments = 0 then 0 else least(1, round(fn.completed::numeric / t.appointments, 4)) end
    ),
    'by_member', coalesce((select jsonb_agg(jsonb_build_object(
        'member_id', bm.member_id, 'full_name', bm.full_name, 'attempts', bm.attempts,
        'customers_called', bm.customers_called, 'reached', bm.reached, 'appointments', bm.appointments, 'completed', bm.completed)
        order by bm.full_name, bm.member_id) from bm), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object(
        'day', bd.day::date, 'attempts', bd.attempts, 'reached', bd.reached, 'appointments', bd.appointments)
        order by bd.day) from bd), '[]'::jsonb),
    'by_outcome', coalesce((select jsonb_agg(jsonb_build_object('outcome', bo.outcome, 'count', bo.cnt)
        order by bo.cnt desc, bo.outcome) from bo), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object(
        'source_detail', bs.src, 'customers', bs.customers, 'appointments', bs.appointments, 'completed', bs.completed)
        order by bs.customers desc, bs.src) from bs), '[]'::jsonb),
    'by_operator', coalesce((select jsonb_agg(jsonb_build_object(
        'operator', bop.op, 'customers', bop.customers, 'completed', bop.completed)
        order by bop.customers desc, bop.op) from bop), '[]'::jsonb),
    'archive', jsonb_build_object(
      'claimed', coalesce((select sum(claimed) from arc_cl), 0)::int,
      'attempts', coalesce((select sum(attempts) from arc_m), 0)::int,
      'customers_called', (select count(distinct customer_id) from att where archive)::int,
      'reached', (select count(distinct customer_id) from att where archive and is_reached)::int,
      'appointments', (select count(*) from att where archive and outcome = 'appointment')::int,
      'completed', (select completed from arc_done),
      'by_member', coalesce((select jsonb_agg(jsonb_build_object(
          'member_id', ab.member_id, 'full_name', ab.full_name, 'claimed', ab.claimed, 'attempts', ab.attempts,
          'customers_called', ab.customers_called, 'reached', ab.reached, 'appointments', ab.appointments)
          order by ab.full_name, ab.member_id) from arc_bm ab), '[]'::jsonb)
    )
  )
  into v_result
  from t, fn, au;

  return v_result;
end;
$$;

revoke execute on function public._report_range(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public._report_range(uuid, uuid, date, date) to service_role;
