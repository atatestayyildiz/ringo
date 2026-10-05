begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'bd-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'bd-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'bd-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b4', 'authenticated', 'authenticated', 'bd-other@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000b1', 'Toplu Silme Kiracı 1'),
  ('10000000-0000-4000-8000-0000000000b2', 'Toplu Silme Kiracı 2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1', 'Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b2', 'Yetkisiz Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b3', 'Yetkili Ajan', 'agent', '{"delete_customers": true}'),
  ('30000000-0000-4000-8000-0000000000b4', '10000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b4', 'Diğer Yönetici', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone, assigned_to) values
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Toplu Bir', '05327774561', null),
  ('40000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b1', 'Toplu Iki', '05327774562', null),
  ('40000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000b1', 'Toplu Uc', '05327774563', null),
  ('40000000-0000-4000-8000-0000000000b4', '10000000-0000-4000-8000-0000000000b1', 'Toplu Dort', '05327774564',
   '30000000-0000-4000-8000-0000000000b3'),
  ('40000000-0000-4000-8000-0000000000b5', '10000000-0000-4000-8000-0000000000b1', 'Toplu Bes', '05327774565', null);

-- Yetkili ajan yalnız bugün kendisine atanmış müşteriyi görür
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000b1', public.tr_today(), '40000000-0000-4000-8000-0000000000b4',
   '30000000-0000-4000-8000-0000000000b3', 1);

-- ACL
select ok(not has_function_privilege('anon', 'public.delete_customers(uuid[])', 'EXECUTE'), 'anon delete_customers çalıştıramaz');
select ok(has_function_privilege('authenticated', 'public.delete_customers(uuid[])', 'EXECUTE'), 'authenticated delete_customers çalıştırabilir');
select ok(not has_function_privilege('authenticated', 'public._delete_customer_core(public.members,uuid,text)', 'EXECUTE'),
          'iç _delete_customer_core authenticated için kapalı');

set local role authenticated;

-- Yetkisiz ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select throws_ok($$select public.delete_customers(array['40000000-0000-4000-8000-0000000000b1']::uuid[])$$,
                 '42501', null, 'yetkisiz ajan toplu silemez');

-- Başka kiracının yöneticisi
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
select throws_ok($$select public.delete_customers(array['40000000-0000-4000-8000-0000000000b1']::uuid[])$$,
                 '42501', null, 'başka kiracı müşterileri toplu silemez');

-- Yetkili ajan: görmediği müşteri reddedilir ve hiçbiri silinmez (atomik)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select throws_ok($$select public.delete_customers(array['40000000-0000-4000-8000-0000000000b4','40000000-0000-4000-8000-0000000000b5']::uuid[])$$,
                 '42501', null, 'yetkili ajan görmediği müşteriyi silemez');
select is((select count(*)::int from public.customers where id = '40000000-0000-4000-8000-0000000000b4'), 1,
          'ret durumunda görünen müşteri de silinmez');

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select public.delete_customers('{}'::uuid[])$$, '22023', null, 'boş seçim reddedilir');
select throws_ok($$select public.delete_customers(array(select gen_random_uuid() from generate_series(1, 501)))$$,
                 '22023', null, '500 üzeri reddedilir');
select is(public.delete_customers(array['40000000-0000-4000-8000-0000000000b1','40000000-0000-4000-8000-0000000000b2','40000000-0000-4000-8000-0000000000b3','40000000-0000-4000-8000-0000000000b3']::uuid[]),
          3, 'yönetici 3 müşteri siler (tekrarlar sayılmaz)');
select is((select count(*)::int from public.customers where id in
           ('40000000-0000-4000-8000-0000000000b1','40000000-0000-4000-8000-0000000000b2','40000000-0000-4000-8000-0000000000b3')),
          0, 'seçilen müşteriler silindi');
select is((select count(*)::int from public.audit_log
           where action = 'customer_deleted' and entity_id in
           ('40000000-0000-4000-8000-0000000000b1','40000000-0000-4000-8000-0000000000b2','40000000-0000-4000-8000-0000000000b3')),
          3, 'her silme için tek audit satırı yazılır');
select is((select data->>'phone' from public.audit_log where action = 'customer_deleted' and entity_id = '40000000-0000-4000-8000-0000000000b1'),
          '•••• 4561', 'audit telefonu maskeli yazar');

-- Yetkili ajan görebildiğini siler
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select is(public.delete_customers(array['40000000-0000-4000-8000-0000000000b4']::uuid[]), 1,
          'yetkili ajan kendi görebildiği müşteriyi toplu siler');

-- anon
reset role;
set local role anon;
select throws_ok($$select public.delete_customers(array['40000000-0000-4000-8000-0000000000b5']::uuid[])$$,
                 '42501', null, 'anon delete_customers çağıramaz');

select * from finish();
rollback;
