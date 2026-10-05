-- Faz 2 inceleme düzeltmeleri 2. tur (migration 20261004001000_faz2_review_fixes2.sql)
-- D1 (gizli kolonlar istemciye kapalı). Push geçişiyle (20261006000100) Telegram kontrolleri push karşılığına çevrildi.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture (kurgusal)
-- Kiracı f1: Yönetici (f1), Sena ajan (f2, tekrar aranacak müşteri), Kaan ajan (f3, yeni müşteri)
-- Kiracı f2: başka kiracının yöneticisi (f4)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'rf2-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'rf2-sen@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated', 'rf2-kaa@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f4', 'authenticated', 'authenticated', 'rf2-oth@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'İkinci Tur Kiracı'),
  ('10000000-0000-4000-8000-0000000000f2', 'Diğer Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Sena Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f3', 'Kaan Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f4', 'Öteki Yönetici', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Ece Bir', '05321260001', 'retry', now(), '30000000-0000-4000-8000-0000000000f2'),
  ('40000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', 'Ozan İki', '05321260002', 'pending', now(), '30000000-0000-4000-8000-0000000000f3');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000f1', public.tr_today(), '40000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f2', 1),
  ('10000000-0000-4000-8000-0000000000f1', public.tr_today(), '40000000-0000-4000-8000-0000000000f2', '30000000-0000-4000-8000-0000000000f3', 1);

insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f2', 'https://push.example.test/rf2-1', repeat('a', 87), repeat('b', 22)),
  ('10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f3', 'https://push.example.test/rf2-2', repeat('a', 87), repeat('b', 22)),
  ('10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f3', 'https://push.example.test/rf2-3', repeat('a', 87), repeat('b', 22));
update public.tenant_settings
set push_enabled = true, distribution_mode = 'manual', distribution_hour = 8, summary_hour = 19
where tenant_id = '10000000-0000-4000-8000-0000000000f1';

-- ---------------------------------------------------------------------------
-- Push geçişi (20261006000100): Telegram kolonları ve tekil sohbet indeksi kalktı
-- ---------------------------------------------------------------------------
select hasnt_column('public', 'members', 'telegram_chat_id', 'telegram_chat_id kolonu yok');
select hasnt_column('public', 'members', 'telegram_linked_at', 'telegram_linked_at kolonu yok');
select ok(to_regclass('public.members_telegram_chat_id_key') is null, 'telegram_chat_id indeksi yok');

-- ---------------------------------------------------------------------------
-- D1: members kolon bazlı SELECT; abonelik anahtarları istemciye kapalı
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.members', 'SELECT')
          and not has_column_privilege('anon', 'public.members', 'id', 'SELECT'),
          'D1: authenticated tablo düzeyinde, anon hiçbir kolonda members okuyamaz');
select ok(has_column_privilege('authenticated', 'public.members', 'id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'tenant_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'user_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'full_name', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'role', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'permissions', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'is_active', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'absent_on', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'created_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_morning', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_summary', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_callback', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_appointment', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'accent_color', 'SELECT'),
          'D1: listelenen kolonlar authenticated için okunur');
select ok(not has_column_privilege('authenticated', 'public.members', 'pin_hash', 'SELECT')
          and not has_column_privilege('authenticated', 'public.members', 'locked_at', 'SELECT'),
          'D1: PIN kolonları yine kapalı');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'p256dh', 'SELECT')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'auth', 'SELECT')
          and not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT'),
          'D1: p256dh ve auth authenticated için kapalı');
select ok(has_column_privilege('service_role', 'public.push_subscriptions', 'p256dh', 'SELECT'),
          'D1: service_role anahtarları okur');

-- Ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.members$$, '42501', null, 'D1: ajan members select * yapamaz');
select is((select string_agg(full_name || ':' || notify_callback, ',' order by full_name) from public.members),
          'Kaan Ajan:true,Kurgu Yönetici:true,Sena Ajan:true', 'D1: ajan ad ve tercih kolonlarını okur (yalnız kendi kiracısı)');
select throws_ok($$select p256dh from public.push_subscriptions$$, '42501', null, 'D1: ajan p256dh okuyamaz');
select throws_ok($$select count(*) from public.push_subscriptions where auth is not null$$, '42501', null,
                 'D1: ajan filtrede de auth kullanamaz');
select is((select count(*)::int from public.push_subscriptions), 1, 'D1: ajan yalnız kendi aboneliğini görür');
select lives_ok($$select public.set_push_prefs(true, false)$$, 'D1: tercih RPC''si çalışır');
reset role;

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.push_subscriptions), 0, 'D1: yönetici başkalarının aboneliğini tablodan göremez');
select is((select sum(devices)::int from public.push_team_status()), 3, 'D1: yönetici ekibin cihaz sayısını RPC ile görür');
reset role;

-- Başka kiracının yöneticisi
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.push_team_status()), 1, 'D1: ekip durumu yalnız kendi kiracısı');
select is((select count(*)::int from public.push_subscriptions), 0, 'D1: başka kiracının aboneliği görünmez');
reset role;

select * from finish();
rollback;
