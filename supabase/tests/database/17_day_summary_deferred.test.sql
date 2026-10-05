-- day_summary ve Telegram özeti: yarına ertelenmiş retry müşteri sayıya girmez (20261005000300)
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'dd-mgr@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Ertelenen Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Ertelenen Yönetici', 'manager', '{}');
insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to, created_at) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Bir', '05321270001', 'pending', now(), '30000000-0000-4000-8000-0000000000e1', now()),
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Iki', '05321270002', 'retry', public.tr_day_start(public.tr_today() + 1) + interval '2 hours', '30000000-0000-4000-8000-0000000000e1', now()),
  ('40000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Uc', '05321270003', 'retry', public.tr_day_start(public.tr_today() + 1) - interval '1 minute', '30000000-0000-4000-8000-0000000000e1', now()),
  ('40000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Dort', '05321270004', 'done', now(), '30000000-0000-4000-8000-0000000000e1', now()),
  ('40000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Bes', '05321270005', 'retry', now() - interval '1 hour', '30000000-0000-4000-8000-0000000000e1', now());
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000e1', public.tr_today(), id, '30000000-0000-4000-8000-0000000000e1',
       row_number() over (order by id)
from public.customers where tenant_id = '10000000-0000-4000-8000-0000000000e1';

-- Telegram özeti kiracıda yalnız yönetici için; hedefleri service_role değil, doğrudan tanım ile sınarız
update public.tenant_settings set telegram_enabled = true, summary_hour = 0
 where tenant_id = '10000000-0000-4000-8000-0000000000e1';
update public.members set telegram_chat_id = 99001, notify_summary = true
 where id = '30000000-0000-4000-8000-0000000000e1';
create temp table _targets on commit drop as
  select * from public._notification_targets(now()) where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'summary';

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

select is((select assigned from public.day_summary() where member_id = '30000000-0000-4000-8000-0000000000e1'),
          4, 'assigned: yarına ertelenmiş retry girmez, bugün içinde daha sonraya ertelenen girer');
select is((select done from public.day_summary() where member_id = '30000000-0000-4000-8000-0000000000e1'),
          1, 'done: ertelenen ilerlemeye sayılmaz, yalnız tamamlanan');
select is((select retries from public.day_summary() where member_id = '30000000-0000-4000-8000-0000000000e1'),
          2, 'retries: ertelenen girmez, vakti bugün olan 2 retry girer');
select is((select count(*)::int from public.day_summary(public.tr_today() + 1) where member_id = '30000000-0000-4000-8000-0000000000e1'),
          0, 'başka güne atama yoksa üye satırı çıkmaz');

reset role;
select is((select (payload -> 'totals' ->> 'assigned')::int from _targets), 4, 'Telegram toplam assigned day_summary ile aynı');
select is((select (payload -> 'totals' ->> 'done')::int from _targets), 1, 'Telegram toplam done day_summary ile aynı');
select is((select (payload -> 'totals' ->> 'retries')::int from _targets), 2, 'Telegram toplam retries day_summary ile aynı');
select is((select (payload -> 'members' -> 0 ->> 'assigned')::int from _targets), 4, 'Telegram üye satırı assigned');

select * from finish();
rollback;
