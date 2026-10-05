-- Dağıtım modları (migration 20261005001000_distribution_modes.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- Kiracı F (free_pool, sınır 2): Ali, Banu ajan. Kiracı M (manual): yönetici + ajan. Kiracı A (auto_even): ajan.
-- Tüm dağıtım saatleri 00:00 (geçmiş).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'dm-ali@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'dm-banu@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated', 'dm-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f4', 'authenticated', 'authenticated', 'dm-mel@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f5', 'authenticated', 'authenticated', 'dm-oto@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'Mod Kiracı Serbest'),
  ('10000000-0000-4000-8000-0000000000f2', 'Mod Kiracı Elle'),
  ('10000000-0000-4000-8000-0000000000f3', 'Mod Kiracı Oto');

update public.tenant_settings set distribution_mode = 'free_pool', claim_limit = 2, distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000f1';
update public.tenant_settings set distribution_mode = 'manual', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000f2';
update public.tenant_settings set distribution_mode = 'auto_even', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000f3';

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Ali Kurgu', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Banu Kurgu', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f3', 'Yönetici Kurgu', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f4', 'Melek Kurgu', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f5', '10000000-0000-4000-8000-0000000000f3', '20000000-0000-4000-8000-0000000000f5', 'Oto Kurgu', 'agent', '{}');

-- F: c1..c3 sahipsiz bekleyen (eskiden yeniye), c4 vakti gelmemiş, c5 Ali'nin tekrar araması,
-- c6 Banu'nun süresi dolmuş havuzu, c7 vakti gelmemiş havuz.
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, pool_count, next_call_at) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Sıra 1', '05321400001', null, 'pending', 0, now() - interval '3 hours'),
  ('40000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Sıra 2', '05321400002', null, 'pending', 0, now() - interval '2 hours'),
  ('40000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Sıra 3', '05321400003', null, 'pending', 0, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Sonra', '05321400004', null, 'pending', 0, now() + interval '2 days'),
  ('40000000-0000-4000-8000-0000000000f5', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Tekrar', '05321400005', '30000000-0000-4000-8000-0000000000f1', 'retry', 0, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000f6', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Havuz Dönen', '05321400006', '30000000-0000-4000-8000-0000000000f2', 'pool', 1, now() - interval '1 day'),
  ('40000000-0000-4000-8000-0000000000f7', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Havuz Bekleyen', '05321400007', '30000000-0000-4000-8000-0000000000f2', 'pool', 1, now() + interval '5 days'),
  -- M: m1 sahipsiz bekleyen, m2 Melek'in tekrar araması
  ('40000000-0000-4000-8000-0000000000e8', '10000000-0000-4000-8000-0000000000f2', 'Kurgu Elle Yeni', '05321400008', null, 'pending', 0, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000e9', '10000000-0000-4000-8000-0000000000f2', 'Kurgu Elle Tekrar', '05321400009', '30000000-0000-4000-8000-0000000000f4', 'retry', 0, now() - interval '1 hour'),
  -- A: a1 sahipsiz bekleyen
  ('40000000-0000-4000-8000-0000000000ea', '10000000-0000-4000-8000-0000000000f3', 'Kurgu Oto Yeni', '05321400010', null, 'pending', 0, now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Şema ve ACL
-- ---------------------------------------------------------------------------
select col_default_is('public', 'tenant_settings', 'claim_limit', '3', 'claim_limit varsayılanı 3');
select throws_ok($$update public.tenant_settings set claim_limit = 0 where tenant_id = '10000000-0000-4000-8000-0000000000f1'$$,
                 '23514', null, 'claim_limit 1 altı reddedilir');
select throws_ok($$update public.tenant_settings set claim_limit = 51 where tenant_id = '10000000-0000-4000-8000-0000000000f1'$$,
                 '23514', null, 'claim_limit 50 üstü reddedilir');
select is(has_function_privilege('anon', 'public.claim_next()', 'execute'), false, 'anon claim_next çalıştıramaz');
select is(has_function_privilege('anon', 'public.claim_queue_status()', 'execute'), false, 'anon claim_queue_status çalıştıramaz');
select is(has_function_privilege('authenticated', 'public.claim_next()', 'execute')
          and has_function_privilege('authenticated', 'public.claim_queue_status()', 'execute'), true,
          'authenticated claim_next ve claim_queue_status çalıştırabilir');
select ok(not has_function_privilege('authenticated', 'public._open_claim_count(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public._open_claim_count(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public._distribute_day_for(uuid, date)', 'execute')
          and not has_function_privilege('authenticated', 'public._scheduled_distribution_at(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public._reassign_core(public.members, uuid, public.members)', 'execute'),
          'iç fonksiyonlar istemci rollerine kapalı');

-- ---------------------------------------------------------------------------
-- Zamanlanmış dağıtım
-- ---------------------------------------------------------------------------
select lives_ok($$select public._scheduled_distribution_at(now())$$, 'zamanlanmış dağıtım çalışır');

-- auto_even regresyonu
select is((select member_id from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000ea' and day = public.tr_today()),
          '30000000-0000-4000-8000-0000000000f5'::uuid, 'auto_even: yeni müşteri dağıtılır');

-- free_pool
select is((select count(*)::int from public.daily_assignments
           where customer_id in ('40000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f2',
                                 '40000000-0000-4000-8000-0000000000f3', '40000000-0000-4000-8000-0000000000f6')),
          0, 'free_pool: yeni müşteri atanmaz');
select is((select member_id from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000f5' and day = public.tr_today()),
          '30000000-0000-4000-8000-0000000000f1'::uuid, 'free_pool: tekrar araması sahibinin listesine konur');
select is((select row(call_status, assigned_to)::text from public.customers where id = '40000000-0000-4000-8000-0000000000f6'),
          row('pending', null::uuid)::text, 'free_pool: süresi dolan havuz sahipsiz bekleyene döner');
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-0000000000f7'),
          'pool', 'free_pool: vakti gelmemiş havuz yerinde kalır');

-- manual
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000e8'),
          0, 'manual: yeni müşteri atanmaz');
select is((select member_id from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000e9' and day = public.tr_today()),
          '30000000-0000-4000-8000-0000000000f4'::uuid, 'manual: tekrar araması sahibinin listesine konur');

-- İkinci çağrı aynı satırı tekrar eklemez
select lives_ok($$select public._scheduled_distribution_at(now())$$, 'zamanlanmış dağıtım ikinci kez çalışır');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000f5'),
          1, 'tekrar çağrı idempotent');

-- ---------------------------------------------------------------------------
-- claim_next (Ali: açık 1 = c5, sınır 2)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select is((select row(mode, waiting, open_count, claim_limit)::text from public.claim_queue_status()),
          row('free_pool', 4, 1, 2)::text, 'claim_queue_status: kuyruk 4, açık 1, sınır 2');
select is((select (public.claim_next()).id), '40000000-0000-4000-8000-0000000000f6'::uuid,
          'claim_next en eski bekleyeni verir (havuzdan dönen)');
select throws_ok($$select public.claim_next()$$, '22023', null, 'sınırda claim_next 22023');
select throws_ok($$select public.take_from_pool('40000000-0000-4000-8000-0000000000f7')$$, '22023', null,
                 'free_pool: sınırda havuzdan alma da 22023');

reset role;
select is((select row(assigned_to, d.member_id, d.position)::text
           from public.customers c join public.daily_assignments d on d.customer_id = c.id and d.day = public.tr_today()
           where c.id = '40000000-0000-4000-8000-0000000000f6'),
          row('30000000-0000-4000-8000-0000000000f1'::uuid, '30000000-0000-4000-8000-0000000000f1'::uuid, 2)::text,
          'alınan müşteri çağırana atanır ve listesinin sonuna eklenir');
select ok(exists(select 1 from public.audit_log where action = 'claim_next'
                 and entity_id = '40000000-0000-4000-8000-0000000000f6'), 'claim_next audit_log yazar');

-- Banu: iki ardışık alma farklı müşteri verir (Ali'nin aldığı tekrar verilmez)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.claim_next()).id), '40000000-0000-4000-8000-0000000000f1'::uuid, 'Banu sıradakini alır (c1)');
select is((select (public.claim_next()).id), '40000000-0000-4000-8000-0000000000f2'::uuid, 'Banu ikinci almada c2 alır');
select throws_ok($$select public.claim_next()$$, '22023', null, 'Banu sınırda');
reset role;

select is((select count(distinct customer_id)::int from public.daily_assignments
           where day = public.tr_today() and tenant_id = '10000000-0000-4000-8000-0000000000f1'
             and customer_id in ('40000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f2',
                                 '40000000-0000-4000-8000-0000000000f6')),
          3, 'aynı müşteri iki kişiye verilmez');

-- Sınır yükselince kalan c3 alınır, sonra uygun yoksa null (c4 vakti gelmemiş)
update public.tenant_settings set claim_limit = 10 where tenant_id = '10000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.claim_next()).id), '40000000-0000-4000-8000-0000000000f3'::uuid, 'Banu c3 alır');
select ok((select (public.claim_next()).id is null), 'uygun müşteri yoksa null döner');
reset role;

-- İzinli üye alamaz
update public.members set absent_on = public.tr_today() where id = '30000000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.claim_next()$$, '22023', null, 'izinli üye claim_next 22023');
reset role;

-- Diğer modlarda claim_next kapalı
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.claim_next()$$, '22023', 'Bu mağazada serbest havuz kapalı.', 'manual: claim_next 22023');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f5","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.claim_next()$$, '22023', 'Bu mağazada serbest havuz kapalı.', 'auto_even: claim_next 22023');
reset role;

-- ---------------------------------------------------------------------------
-- manual: yönetici sahipsiz müşteriyi atar, alıcının bugününe düşer
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
set local role authenticated;
select is(public.reassign_customers(array['40000000-0000-4000-8000-0000000000e8'::uuid], '30000000-0000-4000-8000-0000000000f4'),
          1, 'manual: reassign_customers sahipsiz müşteriyi atar');
reset role;
select is((select row(c.assigned_to, d.member_id, d.position)::text
           from public.customers c join public.daily_assignments d on d.customer_id = c.id and d.day = public.tr_today()
           where c.id = '40000000-0000-4000-8000-0000000000e8'),
          row('30000000-0000-4000-8000-0000000000f4'::uuid, '30000000-0000-4000-8000-0000000000f4'::uuid, 2)::text,
          'manual: atanan müşteri alıcının bugünkü listesinin sonunda');

-- auto_even: aktarım bugünkü satır oluşturmaz (sabah dağıtımı korunur)
insert into public.customers (id, tenant_id, full_name, phone, next_call_at) values
  ('40000000-0000-4000-8000-0000000000eb', '10000000-0000-4000-8000-0000000000f3', 'Kurgu Oto Sonradan', '05321400011', now());
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'dm-otomgr@test.test');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f6', '10000000-0000-4000-8000-0000000000f3', '20000000-0000-4000-8000-0000000000f6', 'Oto Yönetici', 'manager', '{}');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f6","role":"authenticated"}', true);
set local role authenticated;
select is(public.reassign_customers(array['40000000-0000-4000-8000-0000000000eb'::uuid], '30000000-0000-4000-8000-0000000000f5'),
          1, 'auto_even: aktarım çalışır');
reset role;
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000eb'),
          0, 'auto_even: aktarım bugünkü satır eklemez (davranış değişmedi)');

select * from finish();
rollback;
