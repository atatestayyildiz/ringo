-- Tekrar arama hatırlatması kaldırıldı (migration 20261005000400_remove_reminder.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'rm-ajan@test.test');
insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000a1', 'Hatırlatma Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Aylin Ajan', 'agent', '{}');
insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to) values
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Kurgu Müşteri', '05321180001', 'retry', now(), '30000000-0000-4000-8000-0000000000a1');
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000a1', public.tr_today(), '40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', 1);
update public.members set telegram_chat_id = 7001, telegram_linked_at = now(), notify_reminder = true
where id = '30000000-0000-4000-8000-0000000000a1';
update public.tenant_settings
set telegram_enabled = true, distribution_mode = 'manual', distribution_hour = 8, reminder_hour = 10, summary_hour = 19
where tenant_id = '10000000-0000-4000-8000-0000000000a1';

select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '12 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000a1' and kind = 'reminder'),
          0, 'reminder hedefi artık dönmez (saat geçmiş, retry var, tercih açık)');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '23 hours') at time zone 'Europe/Istanbul')
           where kind = 'reminder'),
          0, 'hiçbir saatte reminder hedefi yok');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '12 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000a1' and kind = 'morning'),
          1, 'morning hedefi korunur');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name in ('tenant_settings', 'members')
             and column_name in ('reminder_hour', 'notify_reminder')),
          2, 'reminder_hour ve notify_reminder kolonları düşürülmedi');

select * from finish();
rollback;
