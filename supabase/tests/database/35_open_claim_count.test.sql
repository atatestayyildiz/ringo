-- Serbest havuz sınırı yalnız bekleyenleri sayar (migration 20261008000200_open_claim_count_waiting.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'oc-ali@test.test');
insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000c1', 'Sayım Kiracı');
update public.tenant_settings set distribution_mode = 'free_pool', claim_limit = 2
where tenant_id = '10000000-0000-4000-8000-0000000000c1';
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Ali Sayım', 'agent', '{}');

-- c1 bekleyen, c2 geri arama vakti gelmiş, c3 Açmadı sonrası tekrar, c4 Meşgul sonrası tekrar, c5 geri arama vakti gelmemiş
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, last_outcome, next_call_at) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sayım 1', '05321500001', '30000000-0000-4000-8000-0000000000c1', 'pending', null, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sayım 2', '05321500002', '30000000-0000-4000-8000-0000000000c1', 'retry', 'callback', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sayım 3', '05321500003', '30000000-0000-4000-8000-0000000000c1', 'retry', 'no_answer', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sayım 4', '05321500004', '30000000-0000-4000-8000-0000000000c1', 'retry', 'busy', now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000c5', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Sayım 5', '05321500005', '30000000-0000-4000-8000-0000000000c1', 'retry', 'callback', now() + interval '3 hours');
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000c1', public.tr_today(), id, '30000000-0000-4000-8000-0000000000c1', row_number() over (order by id)
from public.customers where tenant_id = '10000000-0000-4000-8000-0000000000c1';

select is(public._open_claim_count('10000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1'), 2,
          'bekleyen ve vakti gelmiş geri arama sayılır; Açmadı, Meşgul ve vakti gelmemiş sayılmaz');

update public.customers set last_outcome = 'callback' where id = '40000000-0000-4000-8000-0000000000c3';
select is(public._open_claim_count('10000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1'), 3,
          'son sonucu geri arama olan tekrar müşterisi sayılır');

update public.customers set call_status = 'done' where id = '40000000-0000-4000-8000-0000000000c1';
select is(public._open_claim_count('10000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1'), 2,
          'kapanan müşteri sayılmaz');

select ok(not has_function_privilege('authenticated', 'public._open_claim_count(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public._open_claim_count(uuid, uuid)', 'execute'),
          '_open_claim_count istemci rollerine kapalı');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select open_count from public.claim_queue_status()), 2, 'claim_queue_status aynı sayıyı gösterir');
reset role;

select * from finish();
rollback;
