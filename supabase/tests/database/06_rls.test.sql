begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ---------------------------------------------------------------------------
-- Fixture
--  T1: yönetici, A Ajan (dar), B Ajan (dar), C Ajan (view_all_customers)
--  T2: yönetici + 1 müşteri
--  c1 -> A (bugün atanmış), c2 -> B (bugün atanmış), c3 -> A (yalnız dün atanmış)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rl-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rl-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rl-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rl-a3@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rl-mgr2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'rl-nomember@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1'),
  ('10000000-0000-4000-8000-000000000002', 'Test Kiracı 2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager', '{}'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'B Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'C Ajan', 'agent', '{"view_all_customers": true}'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'Yönetici İki', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone, assigned_to) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Müşteri Bir', '05325550001', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Müşteri İki', '05325550002', '30000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Müşteri Üç', '05325550003', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', 'Öteki Müşteri', '05325550009', '30000000-0000-4000-8000-000000000005');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 1),
  ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 1),
  ('10000000-0000-4000-8000-000000000001', public.tr_today() - 1, '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 1);

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome) values
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'no_answer'),
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'busy'),
  ('10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000005', 'busy');

insert into public.pipeline_events (tenant_id, customer_id, member_id, stage) values
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'appointment');

insert into public.audit_log (tenant_id, member_id, action) values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'test'),
  ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', 'test');

-- ---------------------------------------------------------------------------
-- A Ajan (dar yetki)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select results_eq($$select id from public.customers order by id$$,
                  $$values ('40000000-0000-4000-8000-000000000001'::uuid)$$,
                  'ajan yalnız bugün kendine atanmış müşteriyi görür');
select is_empty($$select 1 from public.customers where id = '40000000-0000-4000-8000-000000000002'$$,
                'ajan başkasına atanmış müşteriyi göremez');
select is_empty($$select 1 from public.customers where id = '40000000-0000-4000-8000-000000000003'$$,
                'ajan bugün atanmamış (dünkü) müşterisini göremez');
select is((select count(*)::int from public.call_attempts), 1, 'ajan yalnız kendi müşterisinin denemesini görür');
select is_empty($$select 1 from public.call_attempts where customer_id = '40000000-0000-4000-8000-000000000002'$$,
                'ajan başkasının müşterisine ait denemeyi göremez');
select is_empty($$select 1 from public.pipeline_events$$, 'ajan başkasının aşama geçmişini göremez');
select is((select count(*)::int from public.daily_assignments), 2, 'ajan yalnız kendi atamalarını görür');
select is_empty($$select 1 from public.audit_log$$, 'audit_log ajana kapalı');
select is((select count(*)::int from public.members), 4, 'ajan yalnız kendi kiracısının üyelerini görür');
select is((select count(*)::int from public.tenants), 1, 'ajan yalnız kendi kiracısını görür');

with u as (update public.customers set last_note = 'hack' where id = '40000000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'ajan customers tablosunu doğrudan güncelleyemez') from u;
with u as (delete from public.customers where id = '40000000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'ajan delete_customers yetkisi olmadan silemez') from u;
with u as (update public.members set permissions = '{"view_all_customers": true}'
                      where id = '30000000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'ajan kendi yetkilerini değiştiremez') from u;
with u as (update public.tenant_settings set max_attempts = 9 returning 1)
select is(count(*)::int, 0, 'ajan ayarları değiştiremez') from u;
select throws_ok($$insert into public.customers (tenant_id, full_name, phone)
                   values ('10000000-0000-4000-8000-000000000001', 'Yetkisiz', '05325550050')$$,
                 '42501', null, 'ajan import_customers yetkisi olmadan müşteri ekleyemez');
select throws_ok($$insert into public.call_attempts (tenant_id, customer_id, member_id, outcome)
                   values ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
                           '30000000-0000-4000-8000-000000000002', 'appointment')$$,
                 '42501', null, 'call_attempts tablosuna doğrudan yazılamaz');
select throws_ok($$insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
                   values ('10000000-0000-4000-8000-000000000001', current_date + 5,
                           '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1)$$,
                 '42501', null, 'daily_assignments tablosuna doğrudan yazılamaz');
select throws_ok($$truncate public.customers cascade$$, '42501', null, 'TRUNCATE istemciye kapalı');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-000000000002', 'appointment')$$,
                 '42501', null, 'ajan başkasının müşterisine arama kaydı giremez');
reset role;

-- ---------------------------------------------------------------------------
-- C Ajan (view_all_customers)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.customers), 3, 'view_all_customers ile kiracının tüm müşterileri görünür');
select is((select count(*)::int from public.call_attempts), 2, 'view_all_customers ile tüm denemeler görünür');
with u as (update public.customers set last_note = 'x' returning 1)
select is(count(*)::int, 0, 'view_all_customers salt okunur: güncelleme yok') from u;
select throws_ok($$select public.log_call('40000000-0000-4000-8000-000000000001', 'busy')$$,
                 '42501', null, 'view_all_customers salt okunur: arama kaydı giremez');
select is_empty($$select 1 from public.daily_assignments where member_id <> '30000000-0000-4000-8000-000000000004'$$,
                'view_reports olmadan başkalarının atamaları görünmez');
reset role;

-- ---------------------------------------------------------------------------
-- Yönetici T1
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.customers), 3, 'yönetici kendi kiracısının tüm müşterilerini görür');
select is_empty($$select 1 from public.customers where tenant_id = '10000000-0000-4000-8000-000000000002'$$,
                'başka kiracının müşterisi görünmez');
select is_empty($$select 1 from public.call_attempts where tenant_id = '10000000-0000-4000-8000-000000000002'$$,
                'başka kiracının denemeleri görünmez');
select is((select count(*)::int from public.audit_log), 1, 'yönetici yalnız kendi kiracısının audit_log kaydını görür');
with u as (update public.customers set last_note = 'not' where id = '40000000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'yönetici müşteriyi güncelleyebilir') from u;
with u as (update public.customers set last_note = 'x' where tenant_id = '10000000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'yönetici başka kiracıyı güncelleyemez') from u;
select throws_ok($$select public.log_call('40000000-0000-4000-8000-000000000009', 'busy')$$,
                 '42501', null, 'yönetici başka kiracının müşterisine işlem yapamaz');
select throws_ok($$update public.customers set assigned_to = '30000000-0000-4000-8000-000000000005'
                   where id = '40000000-0000-4000-8000-000000000001'$$,
                 '23503', null, 'müşteri başka kiracının üyesine atanamaz (bileşik FK)');
reset role;

-- ---------------------------------------------------------------------------
-- Üyeliği olmayan / pasif kullanıcı, anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.customers$$, 'üyeliği olmayan kullanıcı hiçbir müşteri görmez');
select throws_ok($$select public.rules_summary_text()$$, '42501', null, 'üyeliği olmayan kullanıcı RPC çağıramaz');
reset role;

update public.members set is_active = false where id = '30000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is_empty($$select 1 from public.customers$$, 'pasif üye hiçbir müşteri görmez');
reset role;

set local role anon;
select throws_ok($$select 1 from public.customers$$, '42501', null, 'anon müşteri tablosuna erişemez');
reset role;

select * from finish();
rollback;
