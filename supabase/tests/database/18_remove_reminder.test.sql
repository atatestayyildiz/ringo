-- Tekrar arama hatırlatması kaldırıldı (migration 20261005000400_remove_reminder.sql);
-- push geçişiyle (20261006000100_push_notifications.sql) reminder_hour ve notify_reminder düşürüldü,
-- sabah/akşam Telegram hedefleri de üretilmez (Yakında).
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
insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', 'https://push.example.test/rm-1', repeat('a', 87), repeat('b', 22));
update public.tenant_settings
set push_enabled = true, distribution_mode = 'manual', distribution_hour = 8, summary_hour = 19
where tenant_id = '10000000-0000-4000-8000-0000000000a1';

select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '12 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000a1' and kind = 'reminder'),
          0, 'reminder hedefi dönmez (retry var, abonelik var)');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '23 hours') at time zone 'Europe/Istanbul')
           where kind in ('reminder', 'morning', 'summary')),
          0, 'hiçbir saatte reminder, morning ya da summary hedefi yok');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name in ('tenant_settings', 'members')
             and column_name in ('reminder_hour', 'notify_reminder')),
          0, 'reminder_hour ve notify_reminder kolonları düşürüldü');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name = 'members'
             and column_name in ('notify_morning', 'notify_summary')),
          2, 'notify_morning ve notify_summary kalır (gelecek)');

select * from finish();
rollback;
