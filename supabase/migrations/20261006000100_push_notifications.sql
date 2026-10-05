-- Web Push bildirimleri ve Telegram'ın kaldırılması (docs/spec-push.md §2).
-- Eski migration dosyaları değişmez. Yeni/yeniden tanımlanan fonksiyonlarda açık revoke/grant.
--
-- KARAR (dağıtım tetiklemesi): eski _notification_targets, sabah mesajından önce saati gelen kiracılar
-- için _distribute_day_for çağırıyordu (yalnız telegram_enabled kiracılarda). Aynı koşul
-- (dağıtım saati geçti; auto_even: bugün ataması yok, free_pool/manual: her çağrı) birebir
-- _scheduled_distribution_at içinde vardır ve run_scheduled_distribution onu pg_cron
-- 'telefoncu-distribution' işiyle 5 dakikada bir, TÜM kiracılar için çalıştırır. Yeni hedefler sabah
-- sayısı üretmediği için bu tetikleme burada tekrar edilmez; dağıtım davranışı kaybolmaz.
--
-- KARAR (aynı gün yeniden planlama): tekillik indeksi spec'teki gibi (member_id, kind, day, ref_id).
-- Aynı müşteri aynı gün yeniden "sonra ara" (ya da randevu saati değişirse) bildirimi tekrar gitsin
-- diye kayıt, müşterinin güncel zamanından (_notification_since) önce sahiplenildiyse "yapıldı"
-- sayılmaz ve _notification_claim satırı yeni plan için sıfırlayıp yeniden sahiplenir.
--
-- notification_log.kind: yeni türler callback, appointment, test. Geçmiş kayıtlar (morning, summary,
-- reminder) silinmesin diye kontrol listesinde kalır; yeni hedef üretilmez.

-- ---------------------------------------------------------------------------
-- 1. Telegram ve eski bildirim fonksiyonları (kolonlardan önce)
-- ---------------------------------------------------------------------------
drop function if exists public._notification_targets(timestamptz);
drop function if exists public._notification_record(uuid, uuid, text, date, text, text);
drop function if exists public._notification_claim(uuid, uuid, text, date);
drop function if exists public._notification_done(uuid, text, date);
drop function if exists public._telegram_consume_link_code(text, bigint);
drop function if exists public._telegram_link_limited(bigint);
drop function if exists public.telegram_create_link_code();
drop function if exists public.telegram_unlink(uuid);
drop function if exists public.set_notify_prefs(boolean, boolean, boolean);

drop table if exists public.telegram_link_attempts;
drop table if exists public.telegram_link_codes;

-- ---------------------------------------------------------------------------
-- 2. members: Telegram kolonları ve notify_reminder düşer; push tercihleri eklenir.
-- SELECT kolon bazlı yeniden yazılır (pin_hash, pin_failed, auto_lock_minutes, locked_at yine kapalı).
-- ---------------------------------------------------------------------------
revoke select on table public.members from authenticated;

drop index if exists public.members_telegram_chat_id_key;
alter table public.members
  drop column telegram_chat_id,
  drop column telegram_linked_at,
  drop column notify_reminder,
  add column notify_callback boolean not null default true,
  add column notify_appointment boolean not null default true;

grant select (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on, created_at,
              notify_morning, notify_summary, notify_callback, notify_appointment, accent_color)
  on table public.members to authenticated;

-- ---------------------------------------------------------------------------
-- 3. tenant_settings
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  drop column telegram_enabled,
  drop column telegram_bot_username,
  drop column reminder_hour,
  add column push_enabled boolean not null default true,
  add column appointment_lead_minutes smallint not null default 60
    constraint tenant_settings_appointment_lead_allowed check (appointment_lead_minutes in (30, 60, 120));

-- ---------------------------------------------------------------------------
-- 4. notification_log: ref_id (müşteri kimliği) ve yeni tekillik
-- ---------------------------------------------------------------------------
alter table public.notification_log add column ref_id uuid;

drop index public.notification_log_once_idx;
create unique index notification_log_once_idx on public.notification_log
  (member_id, kind, day, (coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where kind <> 'test';
create index notification_log_member_kind_ref_idx on public.notification_log (member_id, kind, ref_id, claimed_at desc)
  where ref_id is not null;

alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log
  add constraint notification_log_kind_check
    check (kind in ('callback', 'appointment', 'test', 'morning', 'summary', 'reminder'));

-- ---------------------------------------------------------------------------
-- 5. push_subscriptions: yazma yalnız RPC; çalışan yalnız kendi satırlarını görür,
-- p256dh ve auth istemci rolüne hiç SELECT edilmez (kolon bazlı yetki).
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants,
  member_id uuid not null,
  endpoint text not null unique
    constraint push_subscriptions_endpoint_check check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null,
  auth text not null,
  user_agent text constraint push_subscriptions_user_agent_check check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (tenant_id, member_id) references public.members (tenant_id, id) on delete cascade
);
create index push_subscriptions_member_idx on public.push_subscriptions (member_id, created_at desc);
create index push_subscriptions_tenant_idx on public.push_subscriptions (tenant_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and member_id = (select public.auth_member_id())
    and (select public.auth_unlocked())
  );

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select (id, tenant_id, member_id, endpoint, user_agent, created_at, last_seen_at)
  on table public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. anonymize_member: Telegram kolonları çıkar, cihaz abonelikleri silinir.
-- Gövde 20261005001700_member_delete.sql ile aynı.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_member(p_member uuid)
returns uuid
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
    raise exception 'Kendi hesabınızı silemezsiniz. Başka bir yöneticiden isteyin.' using errcode = '22023';
  end if;
  if t.is_active then
    raise exception 'Silmeden önce çalışanı pasifleştirin.' using errcode = '22023';
  end if;
  if t.user_id is null then
    raise exception 'Bu çalışan zaten silinmiş.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.customers
    where tenant_id = t.tenant_id and assigned_to = t.id and call_status in ('pending', 'retry')
  ) then
    raise exception 'Çalışanın açık müşterileri var. Önce Yönetim ekranından başka bir çalışana devredin.'
      using errcode = '22023';
  end if;

  update public.members
  set full_name = 'Silinmiş kullanıcı',
      role = 'agent',
      permissions = '{}'::jsonb,
      pin_hash = null,
      pin_failed = 0,
      locked_at = null,
      accent_color = null
  where id = t.id;

  delete from public.push_subscriptions where member_id = t.id;

  perform public._audit(m.tenant_id, m.id, 'member_deleted', 'member', t.id, '{}'::jsonb);
  return t.user_id;
end;
$$;

revoke execute on function public.anonymize_member(uuid) from public, anon;
grant execute on function public.anonymize_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Push RPC'leri (security definer, current_member() ile kilit denetimi)
-- ---------------------------------------------------------------------------

-- Bu cihazın aboneliğini kaydeder. Aynı endpoint başka üyedeyse çağırana taşınır (paylaşılan cihaz).
-- Üye başına en çok 10 abonelik: fazlası en eskiden silinir.
create or replace function public.push_subscribe(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_ua text := nullif(left(btrim(coalesce(p_user_agent, '')), 300), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_endpoint !~ '^https://[^\s]+$' or length(v_endpoint) > 2048 then
    raise exception 'Bildirim adresi geçersiz.' using errcode = '22023';
  end if;
  if v_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$' or length(v_p256dh) not between 80 and 100 then
    raise exception 'Bildirim anahtarı geçersiz.' using errcode = '22023';
  end if;
  if v_auth !~ '^[A-Za-z0-9_-]+={0,2}$' or length(v_auth) not between 16 and 44 then
    raise exception 'Bildirim anahtarı geçersiz.' using errcode = '22023';
  end if;

  -- Aynı üyenin eşzamanlı kayıtları sıralanır (10 sınırı)
  perform 1 from public.members where id = m.id for update;

  insert into public.push_subscriptions as ps
    (tenant_id, member_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
  values (m.tenant_id, m.id, v_endpoint, v_p256dh, v_auth, v_ua, v_now, v_now)
  on conflict (endpoint) do update
    set tenant_id = excluded.tenant_id,
        member_id = excluded.member_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = case when ps.member_id = excluded.member_id then ps.created_at else excluded.created_at end,
        last_seen_at = excluded.last_seen_at;

  delete from public.push_subscriptions
  where member_id = m.id
    and id not in (
      select id from public.push_subscriptions
      where member_id = m.id
      order by created_at desc, last_seen_at desc, id
      limit 10);
end;
$$;

-- Bu cihazın aboneliğini siler (yalnız çağıranın kendi satırı)
create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  delete from public.push_subscriptions
  where member_id = m.id and endpoint = btrim(coalesce(p_endpoint, ''));
end;
$$;

-- Çağıranın bildirim durumu
create or replace function public.push_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  return jsonb_build_object(
    'devices', (select count(*)::int from public.push_subscriptions where member_id = m.id),
    'notify_callback', m.notify_callback,
    'notify_appointment', m.notify_appointment,
    'push_enabled', coalesce((select s.push_enabled from public.tenant_settings s where s.tenant_id = m.tenant_id), false));
end;
$$;

-- Kendi tür tercihleri (null verilen alan değişmez)
create or replace function public.set_push_prefs(p_callback boolean, p_appointment boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  update public.members
  set notify_callback = coalesce(p_callback, notify_callback),
      notify_appointment = coalesce(p_appointment, notify_appointment)
  where id = m.id;
end;
$$;

-- Yönetici: kendi kiracısının aktif üyelerinin cihaz sayısı ve tercihleri
create or replace function public.push_team_status()
returns table (member_id uuid, full_name text, devices int, notify_callback boolean, notify_appointment boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  m public.members := public.current_member();
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;
  return query
  select mm.id, mm.full_name,
         (select count(*)::int from public.push_subscriptions ps where ps.member_id = mm.id),
         mm.notify_callback, mm.notify_appointment
  from public.members mm
  where mm.tenant_id = m.tenant_id and mm.is_active
  order by mm.full_name, mm.id;
end;
$$;

-- Yönetici: mağaza anahtarı ve randevu hatırlatma süresi (null verilen alan değişmez)
create or replace function public.set_push_settings(p_enabled boolean, p_lead integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;
  if p_lead is not null and p_lead not in (30, 60, 120) then
    raise exception 'Randevu hatırlatma süresi 30, 60 ya da 120 dakika olmalıdır.' using errcode = '22023';
  end if;
  update public.tenant_settings
  set push_enabled = coalesce(p_enabled, push_enabled),
      appointment_lead_minutes = coalesce(p_lead::smallint, appointment_lead_minutes)
  where tenant_id = m.tenant_id;
  perform public._audit(m.tenant_id, m.id, 'push_settings', 'tenant', m.tenant_id,
    jsonb_build_object('enabled', p_enabled, 'lead', p_lead));
end;
$$;

revoke execute on function
  public.push_subscribe(text, text, text, text),
  public.push_unsubscribe(text),
  public.push_status(),
  public.set_push_prefs(boolean, boolean),
  public.push_team_status(),
  public.set_push_settings(boolean, integer)
from public, anon;

grant execute on function
  public.push_subscribe(text, text, text, text),
  public.push_unsubscribe(text),
  public.push_status(),
  public.set_push_prefs(boolean, boolean),
  public.push_team_status(),
  public.set_push_settings(boolean, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- 8. İç bildirim fonksiyonları (yalnız service_role / postgres)
-- ---------------------------------------------------------------------------

-- Bildirimin ait olduğu planın başlangıcı: callback = next_call_at, appointment = randevu - lead.
-- Bu andan önce sahiplenilmiş kayıt eski plana aittir.
create or replace function public._notification_since(p_kind text, p_ref_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'callback' then
      (select c.next_call_at from public.customers c where c.id = p_ref_id)
    when 'appointment' then
      (select ((c.appointment_day + c.appointment_time) at time zone 'Europe/Istanbul')
              - make_interval(mins => s.appointment_lead_minutes)
       from public.customers c
       join public.tenant_settings s on s.tenant_id = c.tenant_id
       where c.id = p_ref_id and c.appointment_day is not null and c.appointment_time is not null)
  end;
$$;

-- Gönderilmiş, son 10 dakikada sahiplenilmiş ya da 3 denemesi bitmiş kayıt var mı.
-- ref_id verilirse gün yerine müşteri ve plan zamanına bakılır (gece yarısını aşan pencere dahil).
create or replace function public._notification_done(p_member uuid, p_kind text, p_day date, p_ref_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
begin
  if p_ref_id is null then
    return exists (
      select 1 from public.notification_log n
      where n.member_id = p_member and n.kind = p_kind and n.day = p_day and n.ref_id is null
        and (n.status not in ('failed', 'sending')
             or n.attempts >= 3
             or (n.status = 'sending' and n.claimed_at >= now() - interval '10 minutes')));
  end if;

  v_since := public._notification_since(p_kind, p_ref_id);
  return exists (
    select 1 from public.notification_log n
    where n.member_id = p_member and n.kind = p_kind and n.ref_id = p_ref_id
      and (v_since is null or n.claimed_at >= v_since)
      and (n.status not in ('failed', 'sending')
           or n.attempts >= 3
           or (n.status = 'sending' and n.claimed_at >= now() - interval '10 minutes')));
end;
$$;

-- Bir hedef için gönderim hakkını alır. Dönen id ile gönderilir ve _notification_finish çağrılır.
-- null: başka bir çağrı sahiplenmiş, zaten gönderilmiş, deneme hakkı bitmiş ya da (test) dakikada 1 sınırı.
create or replace function public._notification_claim(
  p_tenant uuid, p_member uuid, p_kind text, p_day date, p_ref_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_since timestamptz;
begin
  if p_tenant is null or p_member is null or p_kind is null or p_day is null then
    raise exception 'Bildirim için kiracı, üye, tür ve gün zorunludur.' using errcode = '22023';
  end if;

  -- Test bildirimi: üye başına dakikada 1 (üye satırı kilitlenerek eşzamanlı istekler sıralanır)
  if p_kind = 'test' then
    perform 1 from public.members where id = p_member and tenant_id = p_tenant for update;
    if not found then
      raise exception 'Üye bulunamadı.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.notification_log n
               where n.member_id = p_member and n.kind = 'test' and n.claimed_at > now() - interval '1 minute') then
      return null;
    end if;
    insert into public.notification_log (tenant_id, member_id, kind, day, status, attempts, claimed_at)
    values (p_tenant, p_member, 'test', p_day, 'sending', 1, now())
    returning id into v_id;
    return v_id;
  end if;

  if p_kind in ('callback', 'appointment') and p_ref_id is null then
    raise exception 'Bu bildirim türü için müşteri kimliği zorunludur.' using errcode = '22023';
  end if;

  if p_ref_id is not null then
    perform pg_advisory_xact_lock(hashtext('telefoncu.notification'),
                                  hashtext(p_member::text || ':' || p_kind || ':' || p_ref_id::text));
    if public._notification_done(p_member, p_kind, p_day, p_ref_id) then
      return null;
    end if;
    v_since := public._notification_since(p_kind, p_ref_id);
  end if;

  insert into public.notification_log (tenant_id, member_id, kind, day, ref_id, status, attempts, claimed_at)
  values (p_tenant, p_member, p_kind, p_day, p_ref_id, 'sending', 1, now())
  on conflict (member_id, kind, day, (coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    where kind <> 'test' do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  -- Mevcut satır: eski plana ait (müşteri yeniden planlandı) ya da başarısız / yarım kalmış ve
  -- 3 denemeden azsa yeniden sahiplenilir.
  update public.notification_log n
  set status = 'sending',
      attempts = case when v_since is not null and n.claimed_at < v_since then 1 else n.attempts + 1 end,
      claimed_at = now(),
      error = null
  where n.member_id = p_member and n.tenant_id = p_tenant and n.kind = p_kind and n.day = p_day
    and n.ref_id is not distinct from p_ref_id
    and (
      (v_since is not null and n.claimed_at < v_since)
      or (n.attempts < 3
          and (n.status = 'failed' or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes')))
    )
  returning n.id into v_id;
  return v_id;
end;
$$;

-- Kilit ekranı için ad: yalnız ad ve soyadın baş harfi (büyük, Türkçe i/ı)
create or replace function public._push_name(p_full_name text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'first_name', w[1],
    'last_initial', case when coalesce(array_length(w, 1), 0) > 1
                         then upper(translate(left(w[array_length(w, 1)], 1), 'iı', 'İI'))
                         else '' end)
  from (select regexp_split_to_array(btrim(coalesce(p_full_name, '')), '\s+') as w) x;
$$;

-- Gönderilecek bildirimler. Telefon numarası payload'a girmez.
create or replace function public._notification_targets(p_now timestamptz)
returns table (tenant_id uuid, member_id uuid, kind text, ref_id uuid, payload jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
begin
  -- Geri arama vakti: son sonuç "sonra ara", saati son 45 dakika içinde geldi, müşteri hâlâ açık
  return query
  select c.tenant_id, m.id, 'callback'::text, c.id,
         public._push_name(c.full_name)
           || jsonb_build_object('at', to_char(c.next_call_at at time zone 'Europe/Istanbul', 'HH24:MI'))
  from public.customers c
  join public.members m on m.id = c.assigned_to and m.tenant_id = c.tenant_id
  join public.tenant_settings s on s.tenant_id = c.tenant_id
  where s.push_enabled
    and m.is_active and m.notify_callback
    and c.last_outcome = 'callback'
    and c.call_status in ('pending', 'retry')
    and c.next_call_at <= p_now
    and c.next_call_at > p_now - interval '45 minutes'
    and exists (select 1 from public.push_subscriptions ps where ps.member_id = m.id)
    and not public._notification_done(m.id, 'callback', v_day, c.id);

  -- Randevu hatırlatma: bugünkü randevu, saati - lead geçti, randevu saatinden 10 dakikadan fazla geçmedi
  return query
  select c.tenant_id, m.id, 'appointment'::text, c.id,
         public._push_name(c.full_name)
           || jsonb_build_object('time', to_char(c.appointment_time, 'HH24:MI'))
  from public.customers c
  join public.members m on m.id = c.assigned_to and m.tenant_id = c.tenant_id
  join public.tenant_settings s on s.tenant_id = c.tenant_id
  cross join lateral (
    select ((c.appointment_day + c.appointment_time) at time zone 'Europe/Istanbul') as at
  ) a
  where s.push_enabled
    and m.is_active and m.notify_appointment
    and c.pipeline_stage = 'appointment'
    and c.appointment_day = v_day
    and c.appointment_time is not null
    and a.at - make_interval(mins => s.appointment_lead_minutes) <= p_now
    and a.at > p_now - interval '10 minutes'
    and exists (select 1 from public.push_subscriptions ps where ps.member_id = m.id)
    and not public._notification_done(m.id, 'appointment', v_day, c.id);
end;
$$;

revoke execute on function
  public._notification_since(text, uuid),
  public._notification_done(uuid, text, date, uuid),
  public._notification_claim(uuid, uuid, text, date, uuid),
  public._notification_finish(bigint, text, text),
  public._push_name(text),
  public._notification_targets(timestamptz)
from public, anon, authenticated;

grant execute on function
  public._notification_claim(uuid, uuid, text, date, uuid),
  public._notification_finish(bigint, text, text),
  public._notification_targets(timestamptz)
to service_role;
