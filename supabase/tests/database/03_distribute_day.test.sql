begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ---------------------------------------------------------------------------
-- Fixture: kiracı 1 (yönetici + 3 ajan), kiracı 2 (yönetici + 1 müşteri)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'dd-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'dd-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'dd-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'dd-a3@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'dd-mgr2@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1'),
  ('10000000-0000-4000-8000-000000000002', 'Test Kiracı 2');

insert into public.members (id, tenant_id, user_id, full_name, role, absent_on) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager', null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent', null),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'B Ajan', 'agent', null),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'C Ajan', 'agent', public.tr_today()),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'Yönetici İki', 'manager', null);

-- 8 bekleyen (p01..p08), eskiden yeniye
insert into public.customers (id, tenant_id, full_name, phone, created_at)
select ('40000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '10000000-0000-4000-8000-000000000001', 'Bekleyen ' || i, '0532222' || lpad(i::text, 4, '0'),
       now() - make_interval(hours => 20 - i)
from generate_series(1, 8) i;

-- r: retry, B Ajan'da
insert into public.customers (id, tenant_id, full_name, phone, call_status, attempts_in_round, assigned_to, next_call_at)
values ('40000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000001', 'Tekrar Kişi', '05322220020',
        'retry', 1, '30000000-0000-4000-8000-000000000003', now() - interval '1 day');

-- px: süresi bugün dolan havuz, A Ajan'da; pf: süresi gelecekte dolan havuz
insert into public.customers (id, tenant_id, full_name, phone, call_status, pool_count, assigned_to, next_call_at) values
  ('40000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000001', 'Havuz Dönen', '05322220021',
   'pool', 1, '30000000-0000-4000-8000-000000000002', public.tr_day_start(public.tr_today())),
  ('40000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000001', 'Havuz Bekleyen', '05322220022',
   'pool', 1, '30000000-0000-4000-8000-000000000002', public.tr_day_start(public.tr_today() + 3));

-- done, rızasız, yarın aranacak: aday değil
insert into public.customers (id, tenant_id, full_name, phone, call_status, consent, next_call_at) values
  ('40000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', 'Bitmiş', '05322220023', 'done', true, now()),
  ('40000000-0000-4000-8000-000000000024', '10000000-0000-4000-8000-000000000001', 'Rızasız', '05322220024', 'pending', false, now()),
  ('40000000-0000-4000-8000-000000000025', '10000000-0000-4000-8000-000000000001', 'Yarın', '05322220025', 'retry', true,
   public.tr_day_start(public.tr_today() + 1) + interval '10 hours');

-- kiracı 2 müşterisi
insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000002', 'Öteki Kiracı', '05322220099');

-- ---------------------------------------------------------------------------
-- Ajan dağıtım yapamaz
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.distribute_day()$$, '42501',
                 'Dağıtımı yalnız yönetici başlatabilir.', 'ajan distribute_day çağıramaz');
select throws_ok($$select public._distribute_day_for('10000000-0000-4000-8000-000000000001', current_date)$$,
                 '42501', null, 'iç dağıtım fonksiyonu istemciye kapalı');
select throws_ok($$select public.run_scheduled_distribution()$$,
                 '42501', null, 'cron fonksiyonu istemciye kapalı');
reset role;

-- ---------------------------------------------------------------------------
-- Yönetici dağıtır
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.distribute_day(), 10, 'ilk dağıtım 10 müşteri atar (8 bekleyen + 1 retry + 1 dönen havuz)');

select is((select member_id from public.daily_assignments
           where customer_id = '40000000-0000-4000-8000-000000000020' and day = public.tr_today()),
          '30000000-0000-4000-8000-000000000003'::uuid, 'retry müşteri aynı kişide (B Ajan) kalır');
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-000000000021'),
          'retry', 'süresi dolan havuz retry olur');
select is((select member_id from public.daily_assignments
           where customer_id = '40000000-0000-4000-8000-000000000021' and day = public.tr_today()),
          '30000000-0000-4000-8000-000000000002'::uuid, 'dönen havuz müşterisi önceki ajanda (A Ajan) kalır');
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-000000000022'),
          'pool', 'süresi dolmayan havuz havuzda kalır');
select is((select count(*)::int from public.daily_assignments
           where customer_id in ('40000000-0000-4000-8000-000000000022', '40000000-0000-4000-8000-000000000023',
                                 '40000000-0000-4000-8000-000000000024', '40000000-0000-4000-8000-000000000025')),
          0, 'havuzdaki, bitmiş, rızasız ve yarına ait müşteriler atanmaz');
select is((select count(*)::int from public.daily_assignments
           where member_id = '30000000-0000-4000-8000-000000000004'),
          0, 'bugün yok (absent_on) ajan atlanır');
select is((select count(*)::int from public.daily_assignments where member_id = '30000000-0000-4000-8000-000000000002'),
          5, 'A Ajan 5 müşteri alır');
select is((select count(*)::int from public.daily_assignments where member_id = '30000000-0000-4000-8000-000000000003'),
          5, 'B Ajan 5 müşteri alır (eşit dağıtım)');
select is((select array_agg(position order by position) from public.daily_assignments
           where member_id = '30000000-0000-4000-8000-000000000002'),
          array[1, 2, 3, 4, 5], 'position üye başına 1den artar');
select is((select position from public.daily_assignments where customer_id = '40000000-0000-4000-8000-000000000020'),
          1, 'retry müşteriler sıranın başında');
select is((select count(*)::int from public.customers c
           join public.daily_assignments d on d.customer_id = c.id
           where c.assigned_to is distinct from d.member_id),
          0, 'assigned_to atamayla eşit');

select is(public.distribute_day(), 0, 'aynı gün tekrar çağrı 0 döner (idempotent)');
select is((select count(*)::int from public.daily_assignments where day = public.tr_today()),
          10, 'tekrar çağrı yeni satır eklemez');
reset role;

-- gün içinde yeni müşteri
insert into public.customers (id, tenant_id, full_name, phone)
values ('40000000-0000-4000-8000-000000000030', '10000000-0000-4000-8000-000000000001', 'Öğlen Gelen', '05322220030');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.distribute_day(), 1, 'gün içinde yalnız yeni aday eklenir');
select is((select position from public.daily_assignments where customer_id = '40000000-0000-4000-8000-000000000030'),
          6, 'yeni aday sıranın sonuna eklenir');
select ok(exists(select 1 from public.audit_log where action = 'distribute_day'), 'dağıtım audit_log yazar');
reset role;

select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-000000000099'),
          0, 'başka kiracının müşterisi dağıtılmaz');

-- free_pool modunda atama yapılmaz
update public.tenant_settings set distribution_mode = 'free_pool' where tenant_id = '10000000-0000-4000-8000-000000000001';
insert into public.customers (tenant_id, full_name, phone)
values ('10000000-0000-4000-8000-000000000001', 'Serbest Mod', '05322220031');
select is(public._distribute_day_for('10000000-0000-4000-8000-000000000001', public.tr_today()), 0,
          'free_pool modunda 0 döner');

-- hiç ajan yoksa aktif yönetici alır (kiracı 2)
select is(public._distribute_day_for('10000000-0000-4000-8000-000000000002', public.tr_today()), 1,
          'ajan yoksa yönetici alır');

select * from finish();
rollback;
