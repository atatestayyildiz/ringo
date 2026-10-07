-- Müşteriyi serbest bırakma (migration 20261007000800_release_customer.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'rc-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'rc-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'rc-a2@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000c1', 'Test Kiracı RC');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Yönetici RC', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c2', 'Ajan Bir RC', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c3', 'Ajan İki RC', 'agent', '{}');

insert into public.customers (id, tenant_id, full_name, phone, call_status, assigned_to, attempts_in_round) values
  ('40000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Açık', '05327772001', 'pending', '30000000-0000-4000-8000-0000000000c2', 2),
  ('40000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Başkasının', '05327772002', 'pending', '30000000-0000-4000-8000-0000000000c3', 0),
  ('40000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Kapalı', '05327772003', 'done', '30000000-0000-4000-8000-0000000000c2', 0),
  ('40000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Yönetici', '05327772004', 'retry', '30000000-0000-4000-8000-0000000000c3', 0),
  ('40000000-0000-4000-8000-0000000000d5', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sahipsiz', '05327772005', 'pending', null, 0),
  ('40000000-0000-4000-8000-0000000000d6', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Serbest', '05327772006', 'pending', '30000000-0000-4000-8000-0000000000c2', 1),
  ('40000000-0000-4000-8000-0000000000d7', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Elle', '05327772007', 'retry', '30000000-0000-4000-8000-0000000000c2', 1);

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000c1', public.tr_today(), '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000c2', 1),
  ('10000000-0000-4000-8000-0000000000c1', public.tr_today(), '40000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000c3', 1);

select ok(not has_function_privilege('anon', 'public.release_customer(uuid)', 'EXECUTE'), 'anon release_customer çağıramaz');
select ok(has_function_privilege('authenticated', 'public.release_customer(uuid)', 'EXECUTE'), 'authenticated release_customer çağırır');

-- Ajan Bir: kendi müşterisini bırakır
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is((public.release_customer('40000000-0000-4000-8000-0000000000d1')).call_status, 'pool', 'bırakılan müşteri havuza döner');
select throws_ok($$select public.release_customer('40000000-0000-4000-8000-0000000000d2')$$, '42501', 'Bu müşteri size atanmış değil.', 'başkasının müşterisi bırakılamaz');
select throws_ok($$select public.release_customer('40000000-0000-4000-8000-0000000000d3')$$, '22023', 'Yalnız açık müşteri serbest bırakılabilir.', 'kapanmış müşteri bırakılamaz');
select throws_ok($$select public.release_customer('40000000-0000-4000-8000-0000000000d1')$$, '42501', 'Bu müşteri size atanmış değil.', 'bırakılmış müşteri çalışan tarafından tekrar bırakılamaz');
reset role;

select is((select coalesce(assigned_to::text, '') || '|' || attempts_in_round::text from public.customers where id = '40000000-0000-4000-8000-0000000000d1'),
          '|0', 'sahiplik boşalır, tur sayacı sıfırlanır');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000d1'),
          0, 'günlük atama satırı silinir');
select is((select count(*)::int from public.audit_log where action = 'release_customer' and entity_id = '40000000-0000-4000-8000-0000000000d1'),
          1, 'audit kaydı yazılır');

-- Ajan İki: havuza düşen müşteriyi başka çalışan alabilir (take_from_pool veya Sıradakini al kuyruğu)
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-0000000000d1'),
          'pool', 'havuzdaki müşteri herkese açık durumda');

-- Yönetici: başkasının açık müşterisini bırakabilir
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((public.release_customer('40000000-0000-4000-8000-0000000000d4')).call_status, 'pool', 'yönetici başkasının müşterisini bırakabilir');
select throws_ok($$select public.release_customer('40000000-0000-4000-8000-0000000000d5')$$, '22023', 'Bu müşteri zaten kimseye atanmamış.', 'sahipsiz müşteri bırakılamaz');
reset role;

select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000d4'),
          0, 'yöneticinin bıraktığı müşterinin günlük satırı da silinir');

-- Serbest havuz ve elle dağıtımda müşteri havuza (bekleme) değil, sahipsiz bekleyen olarak sıraya döner
update public.tenant_settings set distribution_mode = 'free_pool' where tenant_id = '10000000-0000-4000-8000-0000000000c1';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is((public.release_customer('40000000-0000-4000-8000-0000000000d6')).call_status, 'pending', 'serbest havuz modunda bırakılan müşteri sıraya (pending) döner');
reset role;
select is((select assigned_to is null and next_call_at <= now() from public.customers where id = '40000000-0000-4000-8000-0000000000d6'),
          true, 'sıradaki müşteri sahipsiz ve vakti gelmiş');
update public.tenant_settings set distribution_mode = 'manual' where tenant_id = '10000000-0000-4000-8000-0000000000c1';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select is((public.release_customer('40000000-0000-4000-8000-0000000000d7')).call_status, 'pending', 'elle dağıtımda da sahipsiz pending olur');
reset role;

select * from finish();
rollback;
