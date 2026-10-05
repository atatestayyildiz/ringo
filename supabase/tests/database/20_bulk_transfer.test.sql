-- Toplu aktarım (migration 20261005000600_bulk_transfer.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Kiracı A: yönetici, ajan1 (açık işler), ajan2 (alıcı), ajan4 (alıcı), pasif ajan3. Kiracı B: yönetici, ajan, müşteri.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'bt-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'bt-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'bt-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c4', 'authenticated', 'authenticated', 'bt-a3@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', 'bt-a4@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c6', 'authenticated', 'authenticated', 'bt-mgrb@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', 'bt-ab@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000c1', 'Aktarım Kiracı A'),
  ('10000000-0000-4000-8000-0000000000c2', 'Aktarım Kiracı B');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions, is_active) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Yönetici Aktarım', 'manager', '{}', true),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c2', 'Ada Bir', 'agent', '{}', true),
  ('30000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c3', 'Bora İki', 'agent', '{}', true),
  ('30000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c4', 'Ceren Üç', 'agent', '{}', false),
  ('30000000-0000-4000-8000-0000000000c5', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c5', 'Deniz Dört', 'agent', '{}', true),
  ('30000000-0000-4000-8000-0000000000c6', '10000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c6', 'Yönetici Diğer', 'manager', '{}', true),
  ('30000000-0000-4000-8000-0000000000c7', '10000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c7', 'Ajan Diğer', 'agent', '{}', true);

-- ajan1: c1,c2 pending; c3 done; c4 retry; c5 pending. Kiracı B: cb.
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Aktarım 1', '05321200001', '30000000-0000-4000-8000-0000000000c2', 'pending'),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Aktarım 2', '05321200002', '30000000-0000-4000-8000-0000000000c2', 'pending'),
  ('40000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Aktarım 3', '05321200003', '30000000-0000-4000-8000-0000000000c2', 'done'),
  ('40000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Aktarım 4', '05321200004', '30000000-0000-4000-8000-0000000000c2', 'retry'),
  ('40000000-0000-4000-8000-0000000000c5', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Aktarım 5', '05321200005', '30000000-0000-4000-8000-0000000000c2', 'pending'),
  ('40000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000c2', 'Kurgu Aktarım B', '05321200009', '30000000-0000-4000-8000-0000000000c7', 'pending');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000c1', public.tr_today(),
       ('40000000-0000-4000-8000-0000000000c' || i)::uuid, '30000000-0000-4000-8000-0000000000c2', i
from generate_series(1, 5) i;

-- ACL
select is(has_function_privilege('anon', 'public.reassign_customers(uuid[], uuid)', 'execute'), false, 'anon reassign_customers çalıştıramaz');
select is(has_function_privilege('anon', 'public.transfer_open_work(uuid, uuid, date)', 'execute'), false, 'anon transfer_open_work çalıştıramaz');
select is(has_function_privilege('authenticated', 'public.reassign_customers(uuid[], uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.transfer_open_work(uuid, uuid, date)', 'execute'), true, 'authenticated iki fonksiyonu çalıştırabilir');
select is(has_function_privilege('authenticated', 'public._move_open_work(uuid, uuid, uuid[], date)', 'execute')
          or has_function_privilege('authenticated', 'public._reassign_core(public.members, uuid, public.members)', 'execute'), false, 'iç fonksiyonlar authenticated için kapalı');

-- Yetkisiz çalışan (ajan2)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.reassign_customers(array['40000000-0000-4000-8000-0000000000c1']::uuid[], '30000000-0000-4000-8000-0000000000c3')$$,
  '42501', null, 'yetkisiz çalışan toplu devredemez');
select throws_ok($$select public.transfer_open_work('30000000-0000-4000-8000-0000000000c2', '30000000-0000-4000-8000-0000000000c3')$$,
  '42501', null, 'yetkisiz çalışan açık işleri aktaramaz');
reset role;

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.reassign_customers(array['40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000c9']::uuid[], '30000000-0000-4000-8000-0000000000c3')$$,
  '42501', null, 'başka kiracı müşterisi reddedilir');
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000c1'),
  '30000000-0000-4000-8000-0000000000c2'::uuid, 'reddedilen toplu çağrı hiçbirini taşımadı');
select throws_ok($$select public.reassign_customers(array['40000000-0000-4000-8000-0000000000c1']::uuid[], '30000000-0000-4000-8000-0000000000c7')$$,
  'P0002', null, 'başka kiracı alıcısı reddedilir');
select throws_ok($$select public.reassign_customers(array['40000000-0000-4000-8000-0000000000c1']::uuid[], '30000000-0000-4000-8000-0000000000c4')$$,
  'P0002', null, 'pasif alıcı reddedilir');
select throws_ok($$select public.reassign_customers('{}'::uuid[], '30000000-0000-4000-8000-0000000000c3')$$,
  '22023', null, 'boş dizi reddedilir');
select throws_ok($$select public.reassign_customers((select array_agg(gen_random_uuid()) from generate_series(1, 501)), '30000000-0000-4000-8000-0000000000c3')$$,
  '22023', null, '500den büyük dizi reddedilir');

-- Toplu devir: c1, c2 -> ajan2
select is(public.reassign_customers(array['40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000c2']::uuid[], '30000000-0000-4000-8000-0000000000c3'),
  2, 'iki müşteri aktarıldı');
select is((select count(*)::int from public.customers where id in ('40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000c2')
           and assigned_to = '30000000-0000-4000-8000-0000000000c3'), 2, 'müşteriler alıcıya atandı');
select is((select count(*)::int from public.daily_assignments where day = public.tr_today() and member_id = '30000000-0000-4000-8000-0000000000c3'
           and customer_id in ('40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000c2')), 2, 'alıcının bugün listesinde görünür');

-- transfer_open_work: ajan1 açık işleri (c4 retry, c5 pending) -> ajan2; c3 done kalır
select is(public.transfer_open_work('30000000-0000-4000-8000-0000000000c2', '30000000-0000-4000-8000-0000000000c3'), 2, 'iki açık iş aktarıldı');
select is((select member_id from public.daily_assignments where day = public.tr_today() and customer_id = '40000000-0000-4000-8000-0000000000c3'),
  '30000000-0000-4000-8000-0000000000c2'::uuid, 'işlenmiş kayıt gönderende kaldı');
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000c3'),
  '30000000-0000-4000-8000-0000000000c2'::uuid, 'işlenmiş müşteri gönderende kaldı');
select is((select count(*)::int from public.daily_assignments where day = public.tr_today() and member_id = '30000000-0000-4000-8000-0000000000c3'), 4, 'alıcının listesinde 4 kayıt');
select is((select absent_on from public.members where id = '30000000-0000-4000-8000-0000000000c2'), null, 'kaynak izinli işaretlenmedi');
select throws_ok($$select public.transfer_open_work('30000000-0000-4000-8000-0000000000c2', '30000000-0000-4000-8000-0000000000c2')$$,
  '22023', null, 'kaynak ve hedef aynı olamaz');
select throws_ok($$select public.transfer_open_work('30000000-0000-4000-8000-0000000000c2', '30000000-0000-4000-8000-0000000000c4')$$,
  'P0002', null, 'pasif hedef reddedilir');

-- Eşit dağıtım: ajan2'nin 4 açık işi, hedef verilmez -> ajan1 (1 işlenmiş) ve ajan4 (0)
select is(public.transfer_open_work('30000000-0000-4000-8000-0000000000c3', null), 4, 'dört açık iş ekibe dağıtıldı');
select is((select count(*)::int from public.daily_assignments where day = public.tr_today() and member_id = '30000000-0000-4000-8000-0000000000c3'), 0, 'kaynakta açık iş kalmadı');
select ok((select abs(
    (select count(*) from public.daily_assignments where day = public.tr_today() and member_id = '30000000-0000-4000-8000-0000000000c2')
  - (select count(*) from public.daily_assignments where day = public.tr_today() and member_id = '30000000-0000-4000-8000-0000000000c5')) <= 1),
  'dağıtım eşit (en çok 1 fark)');

reset role;
select * from finish();
rollback;
