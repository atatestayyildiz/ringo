begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'da-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'da-ag@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'da-other@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000c1', 'Hepsini Sil 1'),
  ('10000000-0000-4000-8000-0000000000c2', 'Hepsini Sil 2');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c2', 'Yetkili Ajan', 'agent', '{"delete_customers": true}'),
  ('30000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c3', 'Diğer Yönetici', 'manager', '{}');
insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Hepsi Bir', '05328880001'),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', 'Hepsi Iki', '05328880002'),
  ('40000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c2', 'Diger Kiraci', '05328880003');
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000c1', public.tr_today(), '40000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1', 1);

select ok(not has_function_privilege('anon', 'public.delete_all_customers(int)', 'EXECUTE'), 'anon çalıştıramaz');
select ok(has_function_privilege('authenticated', 'public.delete_all_customers(int)', 'EXECUTE'), 'authenticated çalıştırabilir');

-- delete_customers yetkili ama yönetici olmayan ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.delete_all_customers(2)$$, '42501', 'Tüm müşterileri yalnız yönetici silebilir.',
                 'yetkili ajan bile hepsini silemez');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.delete_all_customers(5)$$, '22023', 'Müşteri sayısı değişti. Sayfayı yenileyip tekrar deneyin.',
                 'yanlış sayı reddedilir');
select throws_ok($$select public.delete_all_customers(null)$$, '22023', 'Müşteri sayısı değişti. Sayfayı yenileyip tekrar deneyin.',
                 'boş sayı reddedilir');
select is((select count(*)::int from public.customers), 2, 'reddedilince hiçbir şey silinmedi');
select is(public.delete_all_customers(2), 2, 'doğru sayıyla 2 müşteri silindi');
select is((select count(*)::int from public.customers), 0, 'kiracıda müşteri kalmadı');
reset role;

select is((select count(*)::int from public.customers where tenant_id = '10000000-0000-4000-8000-0000000000c2'), 1, 'başka kiracı etkilenmedi');
select is((select count(*)::int from public.daily_assignments where tenant_id = '10000000-0000-4000-8000-0000000000c1'), 0, 'bağlı günlük atamalar da silindi');
select is((select array_agg(action order by id) from public.audit_log
           where tenant_id = '10000000-0000-4000-8000-0000000000c1' and action like 'customer%'),
          array['customers_delete_all'], 'tek audit satırı yazıldı, satır başına değil');

select * from finish();
rollback;
