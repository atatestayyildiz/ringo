-- Ulaşıldı = farklı müşteri (migration 20261005000100_reached_distinct.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'rd-mgr@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'Ulaşıldı Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Ulaşıldı Yönetici', 'manager', '{}');
insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to, created_at) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Alfa', '05321260001', 'done', now(), '30000000-0000-4000-8000-0000000000f1', now()),
  ('40000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Beta', '05321260002', 'retry', now(), '30000000-0000-4000-8000-0000000000f1', now());

-- Alfa'ya iki ulaşılan deneme, Beta'ya ulaşılamayan bir deneme
insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, created_at) values
  ('10000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f1', 'callback', now()),
  ('10000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f1', 'appointment', now()),
  ('10000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f2', '30000000-0000-4000-8000-0000000000f1', 'no_answer', now());

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;

select is((select (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'reached')::int),
          1, 'toplam: aynı müşteriye iki ulaşılan deneme reached 1');
select is((select (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts')::int),
          3, 'toplam: attempts deneme sayısı kalır');
select is((select (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'customers_called')::int),
          2, 'toplam: customers_called 2');
select is((select (public.report_range(public.tr_today(), public.tr_today()) -> 'rates' ->> 'reach_rate')::numeric),
          0.5, 'reach_rate = reached / customers_called');
select is((select (e ->> 'reached')::int || '/' || (e ->> 'customers_called')::int || '/' || (e ->> 'attempts')::int
           from jsonb_array_elements(public.report_range(public.tr_today(), public.tr_today()) -> 'by_member') e
           where e ->> 'member_id' = '30000000-0000-4000-8000-0000000000f1'),
          '1/2/3', 'by_member: reached ve customers_called farklı müşteri');
select is((select (e ->> 'reached')::int
           from jsonb_array_elements(public.report_range(public.tr_today(), public.tr_today()) -> 'by_day') e
           where e ->> 'day' = public.tr_today()::text),
          1, 'by_day: reached farklı müşteri');
select is((select (e ->> 'attempts')::int
           from jsonb_array_elements(public.report_range(public.tr_today(), public.tr_today()) -> 'by_day') e
           where e ->> 'day' = public.tr_today()::text),
          3, 'by_day: attempts deneme sayısı');

select * from finish();
rollback;
