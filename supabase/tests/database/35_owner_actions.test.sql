-- Aşama/randevu/not yetkisi (migration 20261012000100_owner_actions, 20261012000200_manage_all_members):
-- mağazadaki tüm aktif kullanıcılar, gün ve sahiplik bağımsız; başka kiracı kapalı.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'oa-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'oa-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'oa-a2@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000e1', 'Test Kiracı OA'), ('10000000-0000-4000-8000-0000000000e2', 'Test Kiracı OA2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Yönetici OA', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Ajan Bir OA', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e3', 'Ajan İki OA', 'agent', '{"view_all_customers": true}');

-- Bugünkü listede olmayan (günler önce aranmış) müşteriler
insert into public.customers (id, tenant_id, full_name, phone, call_status, pipeline_stage, assigned_to) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Eski Randevu', '05327773001', 'done', 'appointment', '30000000-0000-4000-8000-0000000000e2'),
  ('40000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Havuz', '05327773002', 'pool', null, '30000000-0000-4000-8000-0000000000e2'),
  ('40000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Başkasının', '05327773003', 'done', 'appointment', '30000000-0000-4000-8000-0000000000e1'),
  ('40000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000e2', 'Kurgu Diğer Mağaza', '05327773004', 'done', 'appointment', null);

select ok(not has_function_privilege('anon', 'public.add_customer_note(uuid, text)', 'EXECUTE'), 'anon add_customer_note çağıramaz');
select ok(has_function_privilege('authenticated', 'public.add_customer_note(uuid, text)', 'EXECUTE'), 'authenticated add_customer_note çağırır');
select ok(not has_function_privilege('authenticated', 'public._can_manage(public.members, public.customers)', 'EXECUTE'), '_can_manage authenticated için kapalı');
select ok(not has_table_privilege('authenticated', 'public.customer_notes', 'INSERT'), 'customer_notes doğrudan yazılamaz');

-- Ajan Bir: kendi müşterisi, bugünkü listede değil
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select is((public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f1', 'visited', 'geldi')).pipeline_stage,
          'visited', 'sahip, listede olmayan müşterinin aşamasını değiştirir');
select is((public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f1', 'appointment')).pipeline_stage,
          'appointment', 'sahip randevu aşamasına geri alır');
select is((public.set_appointment('40000000-0000-4000-8000-0000000000f1', public.tr_today() + 1, null)).appointment_day,
          public.tr_today() + 1, 'sahip listede olmayan müşterinin randevu gününü değiştirir');
select is((public.add_customer_note('40000000-0000-4000-8000-0000000000f2', '  havuzdaki müşteriye not  ')).note,
          'havuzdaki müşteriye not', 'sahip kapalı/havuzdaki müşteriye not ekler (boşluk kırpılır)');
select throws_ok($$select public.add_customer_note('40000000-0000-4000-8000-0000000000f2', '   ')$$,
          '22023', 'Not boş olamaz.', 'boş not reddedilir');
select is((public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f3', 'visited')).pipeline_stage,
          'visited', 'çalışan başkasının müşterisinde aşama değiştirir');
select is((public.add_customer_note('40000000-0000-4000-8000-0000000000f3', 'not')).note,
          'not', 'çalışan başkasının müşterisine not ekler');
select throws_ok($$select public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f4', 'visited')$$,
          '42501', 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.', 'başka mağazanın müşterisinde aşama değişmez');
reset role;

-- Ajan İki: tümünü görür ama sahibi değil
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select is((public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f1', 'approved')).pipeline_stage,
          'approved', 'tümünü gören çalışan da aşama değiştirir');
select is((select count(*)::int from public.customer_notes where customer_id = '40000000-0000-4000-8000-0000000000f2'),
          1, 'tümünü gören çalışan notu okur');
reset role;

-- Yönetici: herkesin müşterisinde işlem yapar
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is((public.set_pipeline_stage('40000000-0000-4000-8000-0000000000f1', 'applied')).pipeline_stage,
          'applied', 'yönetici başkasının müşterisinde aşama değiştirir');
select is((public.add_customer_note('40000000-0000-4000-8000-0000000000f1', 'yönetici notu')).member_id,
          '30000000-0000-4000-8000-0000000000e1'::uuid, 'not yazanın adına kaydedilir');
reset role;

select is((select count(*)::int from public.audit_log where action = 'add_customer_note' and tenant_id = '10000000-0000-4000-8000-0000000000e1'),
          3, 'not ekleme audit kaydı yazılır');

select * from finish();
rollback;
