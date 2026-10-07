-- Gelen başvuru özeti (migration 20261007000600_report_intake.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'ri-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'ri-ajan@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'Test Kiracı RI1'),
  ('10000000-0000-4000-8000-0000000000f2', 'Test Kiracı RI2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Yönetici RI', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Ajan RI', 'agent', '{}');

-- Kiracı 1: aralıkta 3 müşteri (1'i aranmış), aralık dışında 1 bekleyen, başka kiracıda 1 bekleyen
insert into public.customers (id, tenant_id, full_name, phone, call_status, created_at) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Bir', '05327771001', 'pending', '2026-10-05 12:00+03'),
  ('40000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000f1', 'Kurgu İki', '05327771002', 'retry', '2026-10-05 13:00+03'),
  ('40000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Üç', '05327771003', 'pending', '2026-10-05 14:00+03'),
  ('40000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Dış', '05327771004', 'pending', '2026-09-01 12:00+03'),
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000f2', 'Kurgu Başka', '05327771005', 'pending', '2026-10-05 12:00+03');

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome) values
  ('10000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000f1', 'no_answer');

select ok(not has_function_privilege('anon', 'public.report_intake(date, date)', 'EXECUTE'), 'anon report_intake çağıramaz');
select ok(has_function_privilege('authenticated', 'public.report_intake(date, date)', 'EXECUTE'), 'authenticated report_intake çağırır');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.report_intake('2026-10-01', '2026-10-07')$$, '42501', 'Raporları görme yetkiniz yok.', 'yetkisiz ajan çağıramaz');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is((public.report_intake('2026-10-01', '2026-10-07')) ->> 'received', '3', 'aralıkta 3 başvuru geldi');
select is((public.report_intake('2026-10-01', '2026-10-07')) ->> 'looked_at', '1', '1 başvuruya bakıldı');
select is((public.report_intake('2026-10-01', '2026-10-07')) ->> 'waiting', '2', '2 başvuru bekliyor');
select is((public.report_intake('2026-10-01', '2026-10-07')) ->> 'waiting_now', '3', 'şu an bekleyen aralık dışını da sayar, başka kiracıyı saymaz');
select is((public.report_intake('2026-10-01', '2026-10-07')) ->> 'waiting_now_unassigned', '3', 'atanmamış bekleyen sayılır');
select is((public.report_intake('2026-10-01', '2026-10-07')) -> 'by_source' -> 0 ->> 'received', '3', 'kaynak kırılımı gelen başvuruyu sayar');
select is((public.report_intake('2026-10-01', '2026-10-07')) -> 'by_operator' -> 0 ->> 'waiting', '2', 'operatör kırılımı bekleyeni sayar');
select throws_ok($$select public.report_intake('2026-10-07', '2026-10-01')$$, '22023', 'Tarih aralığı geçersiz.', 'ters aralık reddedilir');
reset role;

select * from finish();
rollback;
