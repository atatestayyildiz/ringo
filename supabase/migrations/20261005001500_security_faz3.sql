-- Faz 3 güvenlik düzeltmeleri (docs/review-faz3-guvenlik.md): Y1, Y2, D3, D4.

-- Y2: kilitli yönetici oturumu yetki/rol/ekip/ayar yazamaz, audit okuyamaz. Tüm yönetici ve yetki
-- politikaları bu iki yardımcıya dayanır; kilit koşulu burada kapatır. (/kilit sayfası yalnız
-- members_select ve tenant_settings_select kullanır, etkilenmez.)
create or replace function public.auth_is_manager()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'manager' from public.members where user_id = auth.uid() and is_active and locked_at is null),
    false)
$$;

create or replace function public.auth_has_perm(p_perm text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select permissions -> p_perm = 'true'::jsonb from public.members where user_id = auth.uid() and is_active and locked_at is null),
    false)
$$;

-- Y1: şifreli giriş artık kilidi kaldırmaz (GoTrue şifresi oturum jetonuyla PIN'siz değiştirilebiliyordu).
-- Kilit yalnız doğru PIN ile ya da yöneticinin PIN sıfırlamasıyla kalkar.
drop function if exists public.clear_my_lock();

-- Yönetici, aynı kiracıdaki başka bir üyenin PIN'ini sıfırlar: PIN silinir, kilit ve sayaç temizlenir;
-- üye bir sonraki girişte yeni PIN belirler. Kendi PIN'ini sıfırlayamaz (kilitliyken zaten çağıramaz).
create or replace function public.reset_member_pin(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;
  select * into t from public.members where id = p_member and tenant_id = m.tenant_id for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = '22023';
  end if;
  if t.id = m.id then
    raise exception 'Kendi PIN''inizi buradan sıfırlayamazsınız. Başka bir yöneticiden isteyin.' using errcode = '22023';
  end if;
  update public.members set pin_hash = null, locked_at = null, pin_failed = 0 where id = t.id;
  perform public._audit(m.tenant_id, m.id, 'pin_reset', 'member', t.id, '{}'::jsonb);
end;
$$;

revoke execute on function public.reset_member_pin(uuid) from public, anon;
grant execute on function public.reset_member_pin(uuid) to authenticated;

-- D4: kilit olayları audit'e (düz PIN yazılmaz). Gövdeler 20261005001200_panel_lock.sql ile aynı, yalnız _audit eklendi.
create or replace function public.unlock_with_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
  failed int;
begin
  select * into m from public.members where user_id = auth.uid() and is_active for update;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  if m.locked_at is null then
    return jsonb_build_object('ok', true, 'remaining', 5, 'signed_out', false);
  end if;
  if m.pin_hash is null then
    raise exception 'Önce bir PIN belirleyin.' using errcode = '22023';
  end if;
  if m.pin_failed >= 5 then
    return jsonb_build_object('ok', false, 'remaining', 0, 'signed_out', true);
  end if;
  if p_pin is not null and p_pin ~ '^\d{6}$' and extensions.crypt(p_pin, m.pin_hash) = m.pin_hash then
    update public.members set locked_at = null, pin_failed = 0 where id = m.id;
    return jsonb_build_object('ok', true, 'remaining', 5, 'signed_out', false);
  end if;
  failed := m.pin_failed + 1;
  update public.members set pin_failed = failed where id = m.id;
  if failed >= 5 then
    perform public._audit(m.tenant_id, m.id, 'pin_lockout', 'member', m.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', false, 'remaining', greatest(5 - failed, 0), 'signed_out', failed >= 5);
end;
$$;

revoke execute on function public.unlock_with_pin(text) from public, anon;
grant execute on function public.unlock_with_pin(text) to authenticated;

create or replace function public.set_my_pin(p_new text, p_current_pin text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members;
begin
  select * into m from public.members where user_id = auth.uid() and is_active for update;
  if not found then
    raise exception 'Aktif üyelik bulunamadı. Yeniden giriş yapın veya yöneticinize başvurun.'
      using errcode = '42501';
  end if;
  if p_new is null or p_new !~ '^\d{6}$' then
    raise exception 'PIN 6 haneli bir sayı olmalı.' using errcode = '22023';
  end if;
  if public._pin_is_weak(p_new) then
    raise exception 'Bu PIN kolay tahmin edilir. Tekrarlanan ya da sıralı rakamlardan oluşmayan bir PIN seçin.'
      using errcode = '22023';
  end if;
  if m.pin_hash is not null then
    if m.locked_at is not null then
      raise exception 'Panel kilitli.' using errcode = '42501';
    end if;
    if p_current_pin is null or p_current_pin !~ '^\d{6}$'
       or extensions.crypt(p_current_pin, m.pin_hash) <> m.pin_hash then
      raise exception 'Mevcut PIN hatalı.' using errcode = '22023';
    end if;
  end if;
  update public.members
  set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf')),
      pin_failed = 0
  where id = m.id;
  perform public._audit(m.tenant_id, m.id, case when m.pin_hash is null then 'pin_set' else 'pin_changed' end,
    'member', m.id, '{}'::jsonb);
end;
$$;

revoke execute on function public.set_my_pin(text, text) from public, anon;
grant execute on function public.set_my_pin(text, text) to authenticated;

-- D3: take_from_pool'a açık müşteri sınırı. Gövde 20261005001100_morning_modes.sql ile aynı, yalnız sınır eklendi.
create or replace function public.take_from_pool(p_customer uuid)
returns public.customers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  s public.tenant_settings;
  c public.customers;
  v_today date := public.tr_today();
  v_from uuid;
  v_pos int;
begin
  if m.absent_on is not distinct from v_today then
    raise exception 'Bugün izinli olarak işaretlisiniz, havuzdan müşteri alamazsınız.' using errcode = '22023';
  end if;

  select * into s from public.tenant_settings where tenant_id = m.tenant_id;
  -- Serbest havuzda havuz yalnız görüntülenir; dönen müşteri Sıradakini al kuyruğuna girer
  if s.tenant_id is not null and s.distribution_mode = 'free_pool' then
    raise exception 'Serbest havuz modunda müşteriler Sıradakini al ile alınır.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(m.tenant_id::text));

  -- Havuzdan toplu çekmeyi önler: Sıradakini al ile aynı açık müşteri sınırı
  if s.tenant_id is not null and public._open_claim_count(m.tenant_id, m.id) >= s.claim_limit then
    raise exception 'Aynı anda en fazla % açık müşterin olabilir. Listendekileri arayınca yenisini alabilirsin.',
      s.claim_limit using errcode = '22023';
  end if;

  if s.tenant_id is not null and s.distribution_mode = 'auto_even'
     and not exists (select 1 from public.daily_assignments d
                     where d.tenant_id = m.tenant_id and d.day = v_today) then
    if (now() at time zone 'Europe/Istanbul')::time >= make_time(s.distribution_hour, s.distribution_minute, 0) then
      perform public._distribute_day_for(m.tenant_id, v_today);
    else
      raise exception 'Bugünün dağıtımı henüz yapılmadı. Dağıtımdan sonra havuzdan alabilirsiniz.'
        using errcode = '22023';
    end if;
  end if;

  select * into c from public.customers
  where id = p_customer and tenant_id = m.tenant_id
  for update;
  if not found or c.call_status <> 'pool' then
    raise exception 'Bu müşteri havuzda değil, başka biri almış olabilir.' using errcode = '22023';
  end if;

  v_from := c.assigned_to;

  update public.customers set
    assigned_to = m.id,
    call_status = 'pending',
    attempts_in_round = 0,
    next_call_at = now(),
    updated_at = now()
  where id = c.id
  returning * into c;

  select coalesce(max(d.position), 0) + 1 into v_pos
  from public.daily_assignments d
  where d.tenant_id = m.tenant_id and d.day = v_today and d.member_id = m.id;

  insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
  values (m.tenant_id, v_today, c.id, m.id, v_pos)
  on conflict (day, customer_id) do update
    set member_id = excluded.member_id, position = excluded.position
    where public.daily_assignments.member_id <> excluded.member_id;

  perform public._audit(m.tenant_id, m.id, 'take_from_pool', 'customer', c.id,
    jsonb_build_object('from', v_from, 'to', m.id, 'pool_count', c.pool_count));
  return c;
end;
$$;

revoke execute on function public.take_from_pool(uuid) from public, anon;
grant execute on function public.take_from_pool(uuid) to authenticated;
