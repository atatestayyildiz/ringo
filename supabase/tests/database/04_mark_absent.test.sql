begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ma-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ma-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ma-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ma-a3@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1');

insert into public.members (id, tenant_id, user_id, full_name, role) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'B Ajan', 'agent'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'C Ajan', 'agent');

insert into public.customers (id, tenant_id, full_name, phone, created_at)
select ('40000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '10000000-0000-4000-8000-000000000001', 'Bekleyen ' || i, '0532333' || lpad(i::text, 4, '0'),
       now() - make_interval(hours => 20 - i)
from generate_series(1, 9) i;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.distribute_day(), 9, '9 müşteri 3 ajana dağıtılır');
select is((select count(*)::int from public.daily_assignments where member_id = '30000000-0000-4000-8000-000000000002'),
          3, 'A Ajan 3 müşteri aldı');

-- A Ajan'ın ilk müşterisi randevu aldı (bitmiş iş, taşınmaz)
do $$
begin
  perform public.log_call(
    (select customer_id from public.daily_assignments
     where member_id = '30000000-0000-4000-8000-000000000002' and position = 1),
    'appointment');
end $$;
reset role;

-- ajan mark_absent çağıramaz
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.mark_absent('30000000-0000-4000-8000-000000000002')$$, '42501', null,
                 'ajan mark_absent çağıramaz');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.mark_absent('30000000-0000-4000-8000-000000000002'), 2, 'bitmemiş 2 atama taşındı');
select is((select absent_on from public.members where id = '30000000-0000-4000-8000-000000000002'),
          public.tr_today(), 'absent_on bugün');
select is((select count(*)::int from public.daily_assignments
           where member_id = '30000000-0000-4000-8000-000000000002' and day = public.tr_today()),
          1, 'A Ajanda yalnız bitmiş atama kaldı');
select is((select array_agg(cnt order by mid) from (
             select member_id as mid, count(*)::int as cnt from public.daily_assignments
             where day = public.tr_today() and member_id <> '30000000-0000-4000-8000-000000000002'
             group by member_id) x),
          array[4, 4], 'taşınanlar diğer ajanlara eşit dağıldı');
select is((select count(*)::int from public.customers c
           join public.daily_assignments d on d.customer_id = c.id and d.day = public.tr_today()
           where c.assigned_to is distinct from d.member_id),
          0, 'taşınan müşterilerin assigned_to alanı güncellendi');
reset role;

-- yeni aday A Ajana gitmez
insert into public.customers (tenant_id, full_name, phone)
values ('10000000-0000-4000-8000-000000000001', 'Sonradan', '05323330050');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.distribute_day(), 1, 'yeni aday dağıtıldı');
select is((select count(*)::int from public.daily_assignments
           where member_id = '30000000-0000-4000-8000-000000000002' and day = public.tr_today()),
          1, 'yok sayılan ajana yeni atama yapılmadı');
reset role;

select * from finish();
rollback;
