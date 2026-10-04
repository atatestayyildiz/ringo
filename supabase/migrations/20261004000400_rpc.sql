-- RPC sözleşmesi (spec §5, §6)
-- Her fonksiyon security definer, search_path sabit; ilk iş current_member() ile
-- çağıranın aktif üyeliğini ve kiracısını doğrular. Yazan her fonksiyon audit_log'a yazar.

-- ---------------------------------------------------------------------------
-- log_call: kural motoru
-- ---------------------------------------------------------------------------
create or replace function public.log_call(
  p_customer uuid,
  p_outcome text,
  p_note text default null,
  p_callback_at timestamptz default null
)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
  c public.customers;
  v_note text := nullif(btrim(p_note), '');
  v_tz constant text := 'Europe/Istanbul';
begin
  if p_outcome is null or p_outcome not in
     ('appointment', 'callback', 'no_answer', 'busy', 'disqualified', 'not_interested', 'wrong_number') then
    raise exception 'Geçersiz arama sonucu. Listeden bir sonuç seçin.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_work(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı. Yöneticinize başvurun.' using errcode = 'P0002';
  end if;

  if p_outcome = 'callback' then
    if p_callback_at is null or p_callback_at <= now() then
      raise exception 'Geri arama zamanı gelecekte bir tarih ve saat olmalı.' using errcode = '22023';
    end if;
  end if;

  insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, note, callback_at)
  values (m.tenant_id, c.id, m.id, p_outcome, v_note,
          case when p_outcome = 'callback' then p_callback_at end);

  c.last_outcome := p_outcome;
  c.last_note := v_note;

  case p_outcome
    when 'appointment' then
      c.call_status := 'done';
      c.pipeline_stage := 'appointment';
      insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
      values (m.tenant_id, c.id, m.id, 'appointment', v_note);
    when 'not_interested' then
      c.call_status := 'done';
      c.pipeline_stage := 'not_interested';
      insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note)
      values (m.tenant_id, c.id, m.id, 'not_interested', v_note);
    when 'disqualified', 'wrong_number' then
      c.call_status := 'disqualified';
    when 'callback' then
      c.call_status := 'retry';
      c.next_call_at := p_callback_at;
    else -- no_answer, busy
      c.attempts_in_round := c.attempts_in_round + 1;
      if c.attempts_in_round < s.max_attempts then
        c.call_status := 'retry';
        c.next_call_at := now();
      elsif c.pool_count < s.max_rounds then
        c.call_status := 'pool';
        c.pool_count := c.pool_count + 1;
        c.attempts_in_round := 0;
        c.next_call_at := public.tr_day_start(((now() at time zone v_tz)::date + s.pool_wait_days));
      else
        c.call_status := 'unreachable';
      end if;
  end case;

  update public.customers set
    call_status = c.call_status,
    pipeline_stage = c.pipeline_stage,
    attempts_in_round = c.attempts_in_round,
    pool_count = c.pool_count,
    next_call_at = c.next_call_at,
    last_outcome = c.last_outcome,
    last_note = c.last_note,
    updated_at = now()
  where id = c.id
  returning * into c;

  perform public._audit(m.tenant_id, m.id, 'log_call', 'customer', c.id,
    jsonb_build_object('outcome', p_outcome, 'call_status', c.call_status,
                       'attempts_in_round', c.attempts_in_round, 'pool_count', c.pool_count));
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_pipeline_stage
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
begin
  if p_stage is null or p_stage not in
     ('appointment', 'visited', 'applied', 'approved', 'rejected', 'completed', 'not_interested') then
    raise exception 'Geçersiz huni aşaması.' using errcode = '22023';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_work(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.' using errcode = '42501';
  end if;

  update public.customers set
    pipeline_stage = p_stage,
    call_status = case when p_stage in ('completed', 'rejected', 'not_interested') then 'done' else call_status end,
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

-- ---------------------------------------------------------------------------
-- Dağıtım alıcıları (iç): aktif, o gün yok sayılmayan ajanlar; hiç yoksa yöneticiler.
-- İsim sırasıyla.
-- ---------------------------------------------------------------------------
create or replace function public._recipients(p_tenant uuid, p_day date, p_exclude uuid default null)
returns table (id uuid, full_name text)
language sql
stable
set search_path = public, pg_temp
as $$
  with a as (
    select m.id, m.full_name from public.members m
    where m.tenant_id = p_tenant and m.role = 'agent' and m.is_active
      and m.absent_on is distinct from p_day and m.id is distinct from p_exclude
  ), g as (
    select m.id, m.full_name from public.members m
    where m.tenant_id = p_tenant and m.role = 'manager' and m.is_active
      and m.absent_on is distinct from p_day and m.id is distinct from p_exclude
  )
  select a.id, a.full_name from a
  union all
  select g.id, g.full_name from g where not exists (select 1 from a)
$$;

-- ---------------------------------------------------------------------------
-- _distribute_day_for: kiracı parametreli iç dağıtım (cron ve distribute_day kullanır)
-- ---------------------------------------------------------------------------
create or replace function public._distribute_day_for(p_tenant uuid, p_day date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.tenant_settings;
  v_end timestamptz;
  v_ids uuid[];
  v_load int[] := '{}';
  v_pos int[] := '{}';
  v_n int;
  v_cnt int;
  v_max int;
  v_idx int;
  i int;
  r record;
  v_count int := 0;
  v_pool int := 0;
begin
  if p_tenant is null or p_day is null then
    raise exception 'Dağıtım için kiracı ve gün zorunludur.' using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = p_tenant;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı.' using errcode = 'P0002';
  end if;
  if s.distribution_mode <> 'auto_even' then
    return 0;
  end if;

  -- Aynı kiracı için eşzamanlı dağıtımları sırala
  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(p_tenant::text));

  v_end := public.tr_day_start(p_day + 1);

  -- Süresi dolan havuz müşterileri tekrar aranacaklara döner
  update public.customers
  set call_status = 'retry', updated_at = now()
  where tenant_id = p_tenant and call_status = 'pool' and next_call_at < v_end;
  get diagnostics v_pool = row_count;

  select array_agg(x.id order by x.full_name, x.id) into v_ids
  from public._recipients(p_tenant, p_day, null) x;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
      jsonb_build_object('day', p_day, 'assigned', 0, 'pool_returned', v_pool, 'reason', 'alıcı yok'));
    return 0;
  end if;

  for i in 1 .. v_n loop
    select count(*)::int, coalesce(max(d.position), 0) into v_cnt, v_max
    from public.daily_assignments d
    where d.tenant_id = p_tenant and d.day = p_day and d.member_id = v_ids[i];
    v_load := v_load || v_cnt;
    v_pos := v_pos || v_max;
  end loop;

  for r in
    select c.id, c.call_status, c.assigned_to
    from public.customers c
    where c.tenant_id = p_tenant
      and c.call_status in ('pending', 'retry')
      and c.consent
      and c.next_call_at < v_end
      and not exists (
        select 1 from public.daily_assignments d where d.day = p_day and d.customer_id = c.id
      )
    order by
      (c.call_status = 'retry') desc,
      case when c.call_status = 'retry' then c.next_call_at end asc nulls last,
      coalesce(c.applied_at, c.created_at) asc,
      c.id
    for update of c
  loop
    v_idx := null;
    if r.call_status = 'retry' and r.assigned_to is not null then
      v_idx := array_position(v_ids, r.assigned_to);
    end if;
    if v_idx is null then
      v_idx := 1;
      for i in 2 .. v_n loop
        if v_load[i] < v_load[v_idx] then
          v_idx := i;
        end if;
      end loop;
    end if;

    v_load[v_idx] := v_load[v_idx] + 1;
    v_pos[v_idx] := v_pos[v_idx] + 1;

    insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
    values (p_tenant, p_day, r.id, v_ids[v_idx], v_pos[v_idx]);

    if r.assigned_to is distinct from v_ids[v_idx] then
      update public.customers set assigned_to = v_ids[v_idx], updated_at = now() where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
    jsonb_build_object('day', p_day, 'assigned', v_count, 'pool_returned', v_pool));
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- distribute_day: yönetici çağırır, kendi kiracısında çalışır
-- ---------------------------------------------------------------------------
create or replace function public.distribute_day(
  p_day date default (now() at time zone 'Europe/Istanbul')::date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if m.role <> 'manager' then
    raise exception 'Dağıtımı yalnız yönetici başlatabilir.' using errcode = '42501';
  end if;
  return public._distribute_day_for(m.tenant_id, coalesce(p_day, public.tr_today()));
end;
$$;

-- ---------------------------------------------------------------------------
-- run_scheduled_distribution: pg_cron saatlik çağırır; saati gelen kiracıları dağıtır
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduled_distribution()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := now() at time zone 'Europe/Istanbul';
  v_total int := 0;
  t record;
begin
  for t in
    select s.tenant_id from public.tenant_settings s
    where s.distribution_mode = 'auto_even'
      and s.distribution_hour = extract(hour from v_local)::int
  loop
    v_total := v_total + public._distribute_day_for(t.tenant_id, v_local::date);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_absent
-- ---------------------------------------------------------------------------
create or replace function public.mark_absent(
  p_member uuid,
  p_day date default (now() at time zone 'Europe/Istanbul')::date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
  v_day date := coalesce(p_day, public.tr_today());
  v_ids uuid[];
  v_load int[] := '{}';
  v_pos int[] := '{}';
  v_n int;
  v_cnt int;
  v_max int;
  v_idx int;
  i int;
  r record;
  v_moved int := 0;
begin
  if m.role <> 'manager' then
    raise exception 'Çalışanı "bugün yok" olarak yalnız yönetici işaretleyebilir.' using errcode = '42501';
  end if;

  select * into t from public.members where id = p_member and tenant_id = m.tenant_id for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  update public.members set absent_on = v_day where id = t.id;

  select array_agg(x.id order by x.full_name, x.id) into v_ids
  from public._recipients(m.tenant_id, v_day, t.id) x;
  v_n := coalesce(array_length(v_ids, 1), 0);

  if v_n > 0 then
    for i in 1 .. v_n loop
      select count(*)::int, coalesce(max(d.position), 0) into v_cnt, v_max
      from public.daily_assignments d
      where d.tenant_id = m.tenant_id and d.day = v_day and d.member_id = v_ids[i];
      v_load := v_load || v_cnt;
      v_pos := v_pos || v_max;
    end loop;

    for r in
      select d.id as assignment_id, d.customer_id
      from public.daily_assignments d
      join public.customers c on c.id = d.customer_id
      where d.tenant_id = m.tenant_id and d.day = v_day and d.member_id = t.id
        and c.call_status in ('pending', 'retry')
      order by d.position
      for update of d
    loop
      v_idx := 1;
      for i in 2 .. v_n loop
        if v_load[i] < v_load[v_idx] then
          v_idx := i;
        end if;
      end loop;
      v_load[v_idx] := v_load[v_idx] + 1;
      v_pos[v_idx] := v_pos[v_idx] + 1;

      update public.daily_assignments
      set member_id = v_ids[v_idx], position = v_pos[v_idx]
      where id = r.assignment_id;

      update public.customers
      set assigned_to = v_ids[v_idx], updated_at = now()
      where id = r.customer_id and assigned_to is not distinct from t.id;

      v_moved := v_moved + 1;
    end loop;
  end if;

  perform public._audit(m.tenant_id, m.id, 'mark_absent', 'member', t.id,
    jsonb_build_object('day', v_day, 'moved', v_moved));
  return v_moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- reassign_customer
-- ---------------------------------------------------------------------------
create or replace function public.reassign_customer(p_customer uuid, p_member uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  t public.members;
  v_today date := public.tr_today();
  v_pos int;
  v_from uuid;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'reassign')) then
    raise exception 'Müşteri devretme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not public._can_view(m, c) then
    raise exception 'Müşteri bulunamadı veya bu müşteriyi görme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into t from public.members
  where id = p_member and tenant_id = m.tenant_id and is_active;
  if not found then
    raise exception 'Devredilecek aktif çalışan bulunamadı.' using errcode = 'P0002';
  end if;

  v_from := c.assigned_to;

  update public.customers set assigned_to = t.id, updated_at = now()
  where id = c.id
  returning * into c;

  if exists (select 1 from public.daily_assignments d
             where d.customer_id = c.id and d.day = v_today and d.member_id <> t.id) then
    select coalesce(max(d.position), 0) + 1 into v_pos
    from public.daily_assignments d
    where d.tenant_id = m.tenant_id and d.day = v_today and d.member_id = t.id;

    update public.daily_assignments
    set member_id = t.id, position = v_pos
    where customer_id = c.id and day = v_today;
  end if;

  perform public._audit(m.tenant_id, m.id, 'reassign_customer', 'customer', c.id,
    jsonb_build_object('from', v_from, 'to', t.id));
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_customers
-- ---------------------------------------------------------------------------
create or replace function public._normalize_operator(p text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := lower(btrim(coalesce(p, '')));
begin
  if v = '' then
    return null;
  elsif v in ('vf', 'vodafone') or v like 'vodaf%' then
    return 'VF';
  elsif v in ('tc', 'tcell', 'turkcell') or v like 'turkc%' or v like 'türkc%' then
    return 'TC';
  elsif v in ('tt', 'avea') or v like '%telekom%' then
    return 'TT';
  end if;
  return null;
end;
$$;

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
  v_name text;
  v_phone text;
  v_alt text;
  v_birth date;
  v_applied timestamptz;
  v_new uuid;
  v_inserted int := 0;
  v_duplicates int := 0;
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

    v_new := null;
    insert into public.customers (
      tenant_id, full_name, phone, phone_alt, operator, birth_date,
      source, source_detail, applied_at, last_note
    ) values (
      m.tenant_id, v_name, v_phone, v_alt, public._normalize_operator(r.v ->> 'operator'), v_birth,
      'import', nullif(btrim(p_source_detail), ''), v_applied, nullif(btrim(r.v ->> 'note'), '')
    )
    on conflict (tenant_id, phone) do nothing
    returning id into v_new;

    if v_new is null then
      v_duplicates := v_duplicates + 1;
    else
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  perform public._audit(m.tenant_id, m.id, 'import_customers', 'customer', null,
    jsonb_build_object('source_detail', p_source_detail, 'inserted', v_inserted,
                       'duplicates', v_duplicates, 'invalid', v_invalid));

  return jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'invalid', v_invalid,
    'invalid_rows', v_invalid_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- upcoming_birthdays
-- ---------------------------------------------------------------------------
create or replace function public.upcoming_birthdays(p_days int default null)
returns table (customer_id uuid, full_name text, birth_date date, days_left int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
  v_today date := public.tr_today();
  v_days int;
begin
  select coalesce(p_days, s.birthday_notice_days) into v_days
  from public.tenant_settings s where s.tenant_id = m.tenant_id;
  v_days := greatest(0, least(coalesce(v_days, 3), 366));

  return query
    select c.id, c.full_name, c.birth_date,
           (public.birthday_next(c.birth_date, v_today) - v_today)::int
    from public.customers c
    where c.tenant_id = m.tenant_id
      and c.birth_date is not null
      and public._can_view(m, c)
      and public.birthday_next(c.birth_date, v_today) - v_today <= v_days
    order by 4, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- day_summary
-- assigned: o günkü atama sayısı
-- done: atananlardan o gün için işi biten (bekleyen/tekrar ve vakti o gün içinde olmayan)
-- reached: o gün ulaşılan farklı müşteri (appointment, callback, not_interested, disqualified)
-- appointments: o gün alınan randevu sayısı
-- retries: atananlardan durumu 'retry' olan
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(
  p_day date default (now() at time zone 'Europe/Istanbul')::date
)
returns table (member_id uuid, full_name text, assigned int, done int, reached int, appointments int, retries int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
  v_day date := coalesce(p_day, public.tr_today());
  v_start timestamptz := public.tr_day_start(coalesce(p_day, public.tr_today()));
  v_end timestamptz := public.tr_day_start(coalesce(p_day, public.tr_today()) + 1);
begin
  if not (m.role = 'manager' or public._has_perm(m, 'view_reports')) then
    raise exception 'Ekip özetini görme yetkiniz yok.' using errcode = '42501';
  end if;

  return query
    select
      mm.id,
      mm.full_name,
      (select count(*) from public.daily_assignments d
        where d.member_id = mm.id and d.day = v_day)::int,
      (select count(*) from public.daily_assignments d
        join public.customers c on c.id = d.customer_id
        where d.member_id = mm.id and d.day = v_day
          and not (c.call_status in ('pending', 'retry') and c.next_call_at < v_end))::int,
      (select count(distinct a.customer_id) from public.call_attempts a
        where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
          and a.outcome in ('appointment', 'callback', 'not_interested', 'disqualified'))::int,
      (select count(*) from public.call_attempts a
        where a.member_id = mm.id and a.created_at >= v_start and a.created_at < v_end
          and a.outcome = 'appointment')::int,
      (select count(*) from public.daily_assignments d
        join public.customers c on c.id = d.customer_id
        where d.member_id = mm.id and d.day = v_day and c.call_status = 'retry')::int
    from public.members mm
    where mm.tenant_id = m.tenant_id
      and ((mm.is_active and mm.role = 'agent')
           or exists (select 1 from public.daily_assignments d where d.member_id = mm.id and d.day = v_day))
    order by mm.full_name, mm.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- rules_summary_text
-- ---------------------------------------------------------------------------
create or replace function public.rules_summary_text()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
begin
  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  if not found then
    raise exception 'Kiracı ayarları bulunamadı.' using errcode = 'P0002';
  end if;
  return format(
    'Ulaşılamayan müşteri aynı gün tekrar aranır. %s başarısız denemeden sonra havuza düşer ve %s gün sonra listeye geri çıkar. Havuza en fazla %s kez düşer, sonra ''ulaşılamadı'' olarak kapanır.',
    s.max_attempts, s.pool_wait_days, s.max_rounds);
end;
$$;

-- ---------------------------------------------------------------------------
-- login_branding: giriş ekranı için marka (oturumsuz). Faz 1 tek kiracı:
-- tam olarak bir kiracı varsa onun markası, yoksa boş sonuç. Kişisel veri dönmez.
-- ---------------------------------------------------------------------------
create or replace function public.login_branding()
returns table (brand_name text, brand_color text, logo_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.brand_name, s.brand_color, s.logo_url
  from public.tenant_settings s
  where (select count(*) from public.tenants) = 1
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE yetkileri: varsayılanı kapat, yalnız RPC sözleşmesini aç.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.current_member(),
  public.auth_tenant_id(),
  public.auth_member_id(),
  public.auth_is_manager(),
  public.auth_has_perm(text),
  public.auth_assigned_today(uuid),
  public.auth_can_view_customer(uuid),
  public.normalize_tr_phone(text),
  public.tr_today(),
  public.tr_day_start(date),
  public.birthday_in_year(date, int),
  public.birthday_next(date, date),
  public.log_call(uuid, text, text, timestamptz),
  public.set_pipeline_stage(uuid, text, text),
  public.distribute_day(date),
  public.mark_absent(uuid, date),
  public.reassign_customer(uuid, uuid),
  public.import_customers(jsonb, text),
  public.upcoming_birthdays(int),
  public.day_summary(date),
  public.rules_summary_text(),
  public.login_branding()
to authenticated;

grant execute on function public.login_branding() to anon;

-- İç fonksiyonlar: service_role dahil istemci rollerine kapalı
revoke execute on function
  public._distribute_day_for(uuid, date),
  public.run_scheduled_distribution(),
  public._audit(uuid, uuid, text, text, uuid, jsonb),
  public._recipients(uuid, date, uuid),
  public._has_perm(public.members, text),
  public._can_work(public.members, public.customers),
  public._can_view(public.members, public.customers)
from service_role;
