-- Sabah mesajı tüm modlarda önce bugünün dağıtımını çalıştırır (migration 20261005001100_morning_modes.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Kiracı S (free_pool) ve E (manual): telegram açık, dağıtım 00:00, bağlı birer ajan.
-- Her kiracıda: ajanın vakti gelmiş tekrar araması (listede değil) + sahipsiz yeni müşteri.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000091', 'authenticated', 'authenticated', 'mm-s@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000092', 'authenticated', 'authenticated', 'mm-e@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000091', 'Sabah Kiracı Serbest'),
  ('10000000-0000-4000-8000-000000000092', 'Sabah Kiracı Elle');
update public.tenant_settings
set telegram_enabled = true, distribution_mode = 'free_pool', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-000000000091';
update public.tenant_settings
set telegram_enabled = true, distribution_mode = 'manual', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-000000000092';
insert into public.members (id, tenant_id, user_id, full_name, role, permissions, telegram_chat_id, telegram_linked_at) values
  ('30000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000091', '20000000-0000-4000-8000-000000000091', 'Seda Kurgu', 'agent', '{}', 7301, now()),
  ('30000000-0000-4000-8000-000000000092', '10000000-0000-4000-8000-000000000092', '20000000-0000-4000-8000-000000000092', 'Emre Kurgu', 'agent', '{}', 7302, now());
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, next_call_at) values
  ('40000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000091', 'Kurgu Sabah Tekrar S', '05321500001', '30000000-0000-4000-8000-000000000091', 'retry', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-000000000092', '10000000-0000-4000-8000-000000000091', 'Kurgu Sabah Yeni S', '05321500002', null, 'pending', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-000000000093', '10000000-0000-4000-8000-000000000092', 'Kurgu Sabah Tekrar E', '05321500003', '30000000-0000-4000-8000-000000000092', 'retry', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-000000000094', '10000000-0000-4000-8000-000000000092', 'Kurgu Sabah Yeni E', '05321500004', null, 'pending', now() - interval '1 hour');

select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          '_notification_targets yalnız service_role');

create temp table mt as
select * from public._notification_targets(now()) where kind = 'morning'
  and tenant_id in ('10000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000092');

-- free_pool
select is((select count(*)::int from mt where member_id = '30000000-0000-4000-8000-000000000091'), 1,
          'free_pool: sabah hedefi var (tekrar araması listeye konmuş)');
select is((select (payload->>'total')::int from mt where member_id = '30000000-0000-4000-8000-000000000091'), 1,
          'free_pool: sabah sayısı sahibin tekrar aramasını sayar');
select is((select (payload->>'retries')::int from mt where member_id = '30000000-0000-4000-8000-000000000091'), 1,
          'free_pool: tekrar sayısı 1');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-000000000092'), 0,
          'free_pool: yeni müşteri atanmaz');

-- manual
select is((select count(*)::int from mt where member_id = '30000000-0000-4000-8000-000000000092'), 1,
          'manual: sabah hedefi var');
select is((select (payload->>'total')::int from mt where member_id = '30000000-0000-4000-8000-000000000092'), 1,
          'manual: sabah sayısı sahibin tekrar aramasını sayar');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-000000000094'), 0,
          'manual: yeni müşteri atanmaz');

-- İkinci çağrı satırı çoğaltmaz
select lives_ok($$select * from public._notification_targets(now())$$, 'ikinci çağrı çalışır');
select is((select count(*)::int from public.daily_assignments
           where customer_id in ('40000000-0000-4000-8000-000000000091', '40000000-0000-4000-8000-000000000093')), 2,
          'tekrar çağrı idempotent');

-- Serbest havuzda havuz yalnız görüntülenir (manual'da alma çalışır)
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, pool_count, next_call_at) values
  ('40000000-0000-4000-8000-000000000095', '10000000-0000-4000-8000-000000000091', 'Kurgu Sabah Havuz S', '05321500005', '30000000-0000-4000-8000-000000000091', 'pool', 1, now() + interval '5 days'),
  ('40000000-0000-4000-8000-000000000096', '10000000-0000-4000-8000-000000000092', 'Kurgu Sabah Havuz E', '05321500006', '30000000-0000-4000-8000-000000000092', 'pool', 1, now() + interval '5 days');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000091","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-000000000095')$$, '22023',
                 'Serbest havuz modunda müşteriler Sıradakini al ile alınır.', 'free_pool: take_from_pool 22023');
reset role;
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-000000000095'), 'pool',
          'free_pool: müşteri havuzda kalır');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000092","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.take_from_pool('40000000-0000-4000-8000-000000000096')).call_status), 'pending',
          'manual: take_from_pool çalışır');
reset role;

select * from finish();
rollback;
