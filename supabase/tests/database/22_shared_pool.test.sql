-- Ortak havuz (migration 20261005000800_shared_pool.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Kiracı A (manual dağıtım: dağıtım saatinden bağımsız): Elif (havuz sahibi), Ayşe (alan), pasif ajan, izinli ajan.
-- Kiracı B: ajan + havuz müşterisi.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'sp-elif@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'sp-ayse@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated', 'sp-pasif@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'sp-izinli@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated', 'sp-b@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d6', 'authenticated', 'authenticated', 'sp-auto@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000d1', 'Havuz Kiracı A'),
  ('10000000-0000-4000-8000-0000000000d2', 'Havuz Kiracı B'),
  ('10000000-0000-4000-8000-0000000000d3', 'Havuz Kiracı Oto');

update public.tenant_settings set distribution_mode = 'manual'
where tenant_id in ('10000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d2');
-- Oto kiracı: dağıtım saati geçmiş (00:00), bugün ataması yok
update public.tenant_settings set distribution_mode = 'auto_even', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000d3';

insert into public.members (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on) values
  ('30000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', 'Elif Kurgu', 'agent', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d2', 'Ayşe Kurgu', 'agent', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d3', 'Pasif Kurgu', 'agent', '{}', false, null),
  ('30000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d4', 'İzinli Kurgu', 'agent', '{}', true, public.tr_today()),
  ('30000000-0000-4000-8000-0000000000d5', '10000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000d5', 'Ajan Diğer', 'agent', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000d6', '10000000-0000-4000-8000-0000000000d3', '20000000-0000-4000-8000-0000000000d6', 'Oto Kurgu', 'agent', '{}', true, null);

-- d1: Elif'in havuz müşterisi, bugün Elif'e atanmıştı (aynı gün havuza düştü). d2: ikinci havuz müşterisi (daha erken dönüş).
-- d3: pending (havuzda değil). d9: kiracı B havuzu. d7: oto kiracı havuzu.
insert into public.customers (id, tenant_id, full_name, phone, operator, assigned_to, call_status, pool_count, attempts_in_round, next_call_at, last_outcome) values
  ('40000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'Kurgu Havuz 1', '05321300001', 'VF', '30000000-0000-4000-8000-0000000000d1', 'pool', 1, 0, now() + interval '7 days', 'no_answer'),
  ('40000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000d1', 'Kurgu Havuz 2', '05321300002', 'TC', '30000000-0000-4000-8000-0000000000d1', 'pool', 2, 0, now() + interval '3 days', 'busy'),
  ('40000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d1', 'Kurgu Bekleyen', '05321300003', null, '30000000-0000-4000-8000-0000000000d1', 'pending', 0, 0, now(), null),
  ('40000000-0000-4000-8000-0000000000d9', '10000000-0000-4000-8000-0000000000d2', 'Kurgu Havuz B', '05321300009', null, '30000000-0000-4000-8000-0000000000d5', 'pool', 1, 0, now() + interval '5 days', 'no_answer'),
  ('40000000-0000-4000-8000-0000000000d7', '10000000-0000-4000-8000-0000000000d3', 'Kurgu Havuz Oto', '05321300007', null, '30000000-0000-4000-8000-0000000000d6', 'pool', 1, 0, now() + interval '5 days', 'no_answer');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000d1', public.tr_today(), '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d1', 1),
  ('10000000-0000-4000-8000-0000000000d1', public.tr_today(), '40000000-0000-4000-8000-0000000000d3', '30000000-0000-4000-8000-0000000000d2', 1);

-- ACL
select is(has_function_privilege('anon', 'public.list_pool()', 'execute'), false, 'anon list_pool çalıştıramaz');
select is(has_function_privilege('anon', 'public.take_from_pool(uuid)', 'execute'), false, 'anon take_from_pool çalıştıramaz');
select is(has_function_privilege('authenticated', 'public.list_pool()', 'execute')
          and has_function_privilege('authenticated', 'public.take_from_pool(uuid)', 'execute'), true, 'authenticated iki fonksiyonu çalıştırabilir');
select is((select 'phone' = any(proargnames) or 'phone_alt' = any(proargnames) from pg_proc
           where oid = 'public.list_pool()'::regprocedure), false, 'list_pool telefon alanı döndürmez');

-- Ayşe (kiracı A ajanı)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;

select results_eq($$select id from public.list_pool()$$,
  $$values ('40000000-0000-4000-8000-0000000000d2'::uuid), ('40000000-0000-4000-8000-0000000000d1'::uuid)$$,
  'Ayşe kiracının havuzunu dönüş tarihine göre görür, başka kiracı yok');
select is((select last_member_name from public.list_pool() where id = '40000000-0000-4000-8000-0000000000d1'),
  'Elif Kurgu', 'son çalışan adı döner');
select is((select pool_count from public.list_pool() where id = '40000000-0000-4000-8000-0000000000d2'), 2, 'havuz sayısı döner');
select is((select count(*)::int from public.customers where id = '40000000-0000-4000-8000-0000000000d1'), 0,
  'Ayşe Elif''in havuz müşterisini tablodan (telefonuyla) okuyamaz');
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000d9')$$,
  '22023', null, 'başka kiracının müşterisi alınamaz');
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000d3')$$,
  '22023', 'Bu müşteri havuzda değil, başka biri almış olabilir.', 'havuzda olmayan müşteri alınamaz');

select is((select assigned_to from public.take_from_pool('40000000-0000-4000-8000-0000000000d1')),
  '30000000-0000-4000-8000-0000000000d2'::uuid, 'take_from_pool müşteriyi Ayşe''ye atar');
reset role;

select is((select call_status from public.customers where id = '40000000-0000-4000-8000-0000000000d1'), 'pending', 'durum pending');
select is((select pool_count from public.customers where id = '40000000-0000-4000-8000-0000000000d1'), 1, 'pool_count korunur');
select ok((select next_call_at <= now() and attempts_in_round = 0 from public.customers where id = '40000000-0000-4000-8000-0000000000d1'),
  'next_call_at şimdi, deneme sayacı sıfır');
select is((select member_id from public.daily_assignments where day = public.tr_today() and customer_id = '40000000-0000-4000-8000-0000000000d1'),
  '30000000-0000-4000-8000-0000000000d2'::uuid, 'bugünkü atama satırı Ayşe''ye taşındı (tekil kısıt çakışması)');
select is((select position from public.daily_assignments where day = public.tr_today() and customer_id = '40000000-0000-4000-8000-0000000000d1'),
  2, 'Ayşe''nin listesinin sonuna eklendi');
select is((select count(*)::int from public.audit_log where action = 'take_from_pool' and entity_id = '40000000-0000-4000-8000-0000000000d1'),
  1, 'işlem logu yazıldı');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.customers where id = '40000000-0000-4000-8000-0000000000d1'), 1, 'Ayşe artık müşteriyi okuyabilir');
reset role;

-- Elif: ikinci alma denemesi
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000d1')$$,
  '22023', 'Bu müşteri havuzda değil, başka biri almış olabilir.', 'ikinci alma denemesi reddedilir');
reset role;

-- Pasif üye
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000d2')$$, '42501', null, 'pasif üye alamaz');
select throws_ok($$select * from public.list_pool()$$, '42501', null, 'pasif üye havuzu listeleyemez');
reset role;

-- İzinli üye
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000d2')$$, '22023', null, 'izinli üye alamaz');
reset role;

-- Oto dağıtım kiracısı: dağıtım saati geçmiş ama bugün dağıtım yok -> önce dağıtım çalışır, sonra alma yapılır
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d6","role":"authenticated"}', true);
set local role authenticated;
select is((select call_status from public.take_from_pool('40000000-0000-4000-8000-0000000000d7')), 'pending', 'oto kiracıda alma yapılır');
reset role;
select is((select count(*)::int from public.audit_log
           where action = 'distribute_day' and tenant_id = '10000000-0000-4000-8000-0000000000d3'), 1,
  'alma öncesi kaçan günlük dağıtım çalıştırıldı');

select * from finish();
rollback;
