-- docs/review-faz1.md düzeltmeleri (Y1, O1, O2, O3, D2 kısmi, D4 kısmi).
-- Eski migration dosyaları değişmez; fonksiyonlar burada yeniden tanımlanır
-- (create or replace mevcut EXECUTE yetkilerini korur).

-- ---------------------------------------------------------------------------
-- Y1. log_call yalnız arama kaydı açık (pending/retry) müşteride çalışır.
-- Kapanmış/havuzdaki müşterinin huni ilerlemesi set_pipeline_stage ile yapılır.
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

  if c.call_status not in ('pending', 'retry') then
    raise exception 'Bu müşteri için arama kaydı açık değil (durum: %).',
      case c.call_status
        when 'pool' then 'havuzda'
        when 'done' then 'tamamlandı'
        when 'unreachable' then 'ulaşılamadı'
        when 'disqualified' then 'uygun değil'
        else c.call_status
      end
      using errcode = '22023';
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
-- O1. Müşteri ekleme yalnız import_customers RPC'si üzerinden (audit + kural motoru).
-- ---------------------------------------------------------------------------
drop policy if exists customers_insert on public.customers;
revoke insert on table public.customers from authenticated;

-- ---------------------------------------------------------------------------
-- O2. delete_customer: yönetici VEYA (delete_customers yetkisi VE müşteriyi görebiliyor).
-- Audit'te ad baş harfleri ve telefonun son 4 hanesi; silmede tek audit satırı.
-- ---------------------------------------------------------------------------
create or replace function public._name_initials(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select string_agg(upper(left(w, 1)) || '.', ' ' order by ord)
  from regexp_split_to_table(btrim(coalesce(p, '')), '\s+') with ordinality as t(w, ord)
  where w <> ''
$$;

revoke execute on function public._name_initials(text) from public, anon, authenticated, service_role;

create or replace function public.delete_customer(p_customer uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  c public.customers;
  v_digits text;
begin
  if not (m.role = 'manager' or public._has_perm(m, 'delete_customers')) then
    raise exception 'Müşteri silme yetkiniz yok.' using errcode = '42501';
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or not (m.role = 'manager' or public._can_view(m, c)) then
    raise exception 'Müşteri bulunamadı veya bu müşteriyi görme yetkiniz yok.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(c.phone, ''), '\D', '', 'g');
  perform public._audit(m.tenant_id, m.id, 'customer_deleted', 'customer', c.id,
    jsonb_build_object(
      'initials', public._name_initials(c.full_name),
      'phone', '•••• ' || right(v_digits, 4),
      'reason', nullif(btrim(p_reason), '')
    ));

  -- Tetikleyici bu silme için ikinci (boş) audit satırı yazmasın
  perform set_config('telefoncu.audited_delete', c.id::text, true);
  delete from public.customers where id = c.id;
  perform set_config('telefoncu.audited_delete', '', true);
end;
$$;

-- 0600 döneminde yazılmış tam adları geriye dönük maskele
update public.audit_log
set data = (data - 'full_name') || jsonb_build_object('initials', public._name_initials(data ->> 'full_name'))
where action = 'customer_deleted' and data ? 'full_name';

-- Tetikleyici yalnız RPC dışı silmeleri (service role, bakım) kayda geçirir.
create or replace function public.tg_customers_audit_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('telefoncu.audited_delete', true), '') = old.id::text then
    return old;
  end if;
  perform public._audit(old.tenant_id, public.auth_member_id(), 'customer_delete', 'customer', old.id, '{}'::jsonb);
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- O3. distribute_day yalnız bugün için; iç fonksiyon gelecek gün için çağrılırsa
-- bugünkü atamaların assigned_to'su değişmez. Bugünkü dağıtım, bugünkü atama
-- satırlarıyla assigned_to'yu eşitler.
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
  v_is_today boolean;
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
  v_is_today := p_day = public.tr_today();

  -- Süresi dolan havuz müşterileri tekrar aranacaklara döner
  update public.customers
  set call_status = 'retry', updated_at = now()
  where tenant_id = p_tenant and call_status = 'pool' and next_call_at < v_end;
  get diagnostics v_pool = row_count;

  -- Bugünkü atama satırları ile assigned_to tutarlı olsun (ileri tarihli dağıtımdan kalan farklar)
  if v_is_today then
    update public.customers c
    set assigned_to = d.member_id, updated_at = now()
    from public.daily_assignments d
    where d.customer_id = c.id and d.day = p_day and d.tenant_id = p_tenant
      and c.tenant_id = p_tenant and c.assigned_to is distinct from d.member_id;
  end if;

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

    -- assigned_to yalnız bugünün dağıtımında değişir; ileri gün bugünkü işi koparmaz
    if v_is_today and r.assigned_to is distinct from v_ids[v_idx] then
      update public.customers set assigned_to = v_ids[v_idx], updated_at = now() where id = r.id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform public._audit(p_tenant, public.auth_member_id(), 'distribute_day', 'tenant', p_tenant,
    jsonb_build_object('day', p_day, 'assigned', v_count, 'pool_returned', v_pool));
  return v_count;
end;
$$;

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
  if p_day is not null and p_day <> public.tr_today() then
    raise exception 'Dağıtım yalnız bugün için yapılabilir.' using errcode = '22023';
  end if;
  return public._distribute_day_for(m.tenant_id, public.tr_today());
end;
$$;

-- ---------------------------------------------------------------------------
-- D4 (kısmi). mark_absent ve reassign_customer dağıtım kilidini alır.
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

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

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

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

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
-- D2 (kısmi). members: istemci yalnız yönetimsel kolonları güncelleyebilir
-- (user_id, tenant_id, id değişmez); kiracıda son aktif yönetici korunur.
-- ---------------------------------------------------------------------------
revoke update on table public.members from authenticated;
grant update (full_name, role, permissions, is_active, absent_on) on table public.members to authenticated;

create or replace function public.tg_members_keep_manager()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role = 'manager' and old.is_active
     and (tg_op = 'DELETE' or not (new.role = 'manager' and new.is_active)) then
    -- Eşzamanlı iki düşürmeyi sırala
    perform 1 from public.members
    where tenant_id = old.tenant_id and role = 'manager' and is_active
    for update;
    if not exists (
      select 1 from public.members
      where tenant_id = old.tenant_id and role = 'manager' and is_active and id <> old.id
    ) then
      raise exception 'Kiracıda en az bir aktif yönetici kalmalı. Önce başka bir yönetici atayın.'
        using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.tg_members_keep_manager() from public, anon, authenticated, service_role;

drop trigger if exists members_keep_manager on public.members;
create trigger members_keep_manager
before update of role, is_active or delete on public.members
for each row execute function public.tg_members_keep_manager();
