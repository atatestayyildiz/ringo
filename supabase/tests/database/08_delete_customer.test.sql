begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'dc-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'dc-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'dc-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a4', 'authenticated', 'authenticated', 'dc-other@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000a1', 'Silme Kiracı 1'),
  ('10000000-0000-4000-8000-0000000000a2', 'Silme Kiracı 2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a2', 'Yetkisiz Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a3', 'Yetkili Ajan', 'agent', '{"delete_customers": true}'),
  ('30000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000a4', 'Diğer Yönetici', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Silinecek Bir', '05327774567'),
  ('40000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a1', 'Silinecek Iki', '05327771234'),
  ('40000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a1', 'Doğrudan Silinmez', '05327770000');

-- Yetkisiz ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000a1')$$,
                 '42501', null, 'yetkisiz ajan delete_customer çağıramaz');

-- Doğrudan DELETE etkisiz (yönetici dahil)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
with d as (delete from public.customers where id = '40000000-0000-4000-8000-0000000000a3' returning 1)
select is(count(*)::int, 0, 'doğrudan DELETE yönetici için de etkisiz') from d;

-- Yönetici siler, neden ile
select lives_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000a1', 'KVKK talebi')$$,
                'yönetici müşteriyi siler');
select is((select count(*)::int from public.customers where id = '40000000-0000-4000-8000-0000000000a1'), 0,
          'müşteri silindi');
select is((select data->>'phone' from public.audit_log where action = 'customer_deleted' and entity_id = '40000000-0000-4000-8000-0000000000a1'),
          '•••• 4567', 'audit telefonu maskeli yazar');
select is((select data->>'reason' from public.audit_log where action = 'customer_deleted' and entity_id = '40000000-0000-4000-8000-0000000000a1'),
          'KVKK talebi', 'audit silme nedenini yazar');
select is((select count(*)::int from public.audit_log
           where action = 'customer_deleted' and data::text like '%05327774567%'), 0,
          'audit tam telefonu içermez');

-- Başka kiracının yöneticisi silemez
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select throws_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000a2')$$,
                 '42501', null, 'başka kiracı müşteri silinemez');

-- delete_customers yetkili ajan siler
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select lives_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000a2')$$,
                'delete_customers yetkili ajan siler');

-- anon çağıramaz
reset role;
set local role anon;
select throws_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000a3')$$,
                 '42501', null, 'anon delete_customer çağıramaz');

select * from finish();
rollback;
