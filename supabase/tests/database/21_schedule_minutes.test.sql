-- Gönderim saatleri dakika bazlı (migration 20261005000700_schedule_minutes.sql); push hedefleri dakika bazlı (20261006000100)
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ---------------------------------------------------------------------------
-- Fixture. Kiracı A (manual, push açık): yönetici + ajan, ajana bugün 1 atama, 09:30 randevu, 19:30 geri arama.
-- Kiracı B (auto_even, push kapalı): ajan + 2 bekleyen müşteri.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'sm-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'sm-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'sm-b1@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Dakika Kiracı A'),
  ('10000000-0000-4000-8000-0000000000e2', 'Dakika Kiracı B');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Yönetici Dakika', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Selin Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e3', 'Kaan Ajan', 'agent', '{}');
insert into public.customers (id, tenant_id, full_name, phone, assigned_to) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Dakika 1', '05321210001', '30000000-0000-4000-8000-0000000000e2');
insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e2', 'Kurgu Dakika 2', '05321210002'),
  ('40000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e2', 'Kurgu Dakika 3', '05321210003');
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 1);
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, pipeline_stage, appointment_day, appointment_time) values
  ('40000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Randevu', '05321210005', '30000000-0000-4000-8000-0000000000e2', 'done', 'appointment', public.tr_today(), '09:30');
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, last_outcome, next_call_at) values
  ('40000000-0000-4000-8000-0000000000e6', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Geriarama', '05321210006', '30000000-0000-4000-8000-0000000000e2', 'retry', 'callback',
   (public.tr_today()::timestamp + interval '19 hours 30 minutes') at time zone 'Europe/Istanbul');
insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'https://push.example.test/sm-1', repeat('a', 87), repeat('b', 22)),
  ('10000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e3', 'https://push.example.test/sm-2', repeat('a', 87), repeat('b', 22));
update public.tenant_settings
set push_enabled = true, distribution_mode = 'manual', appointment_lead_minutes = 60,
    distribution_hour = 8, distribution_minute = 30, summary_hour = 19, summary_minute = 30
where tenant_id = '10000000-0000-4000-8000-0000000000e1';
update public.tenant_settings
set push_enabled = false, distribution_mode = 'auto_even', distribution_hour = 8, distribution_minute = 30
where tenant_id = '10000000-0000-4000-8000-0000000000e2';

create temp table at_time (label text primary key, ts timestamptz);
insert into at_time values
  ('0829', (public.tr_today()::timestamp + interval '8 hours 29 minutes') at time zone 'Europe/Istanbul'),
  ('0830', (public.tr_today()::timestamp + interval '8 hours 30 minutes') at time zone 'Europe/Istanbul'),
  ('0845', (public.tr_today()::timestamp + interval '8 hours 45 minutes') at time zone 'Europe/Istanbul'),
  ('1929', (public.tr_today()::timestamp + interval '19 hours 29 minutes') at time zone 'Europe/Istanbul'),
  ('1930', (public.tr_today()::timestamp + interval '19 hours 30 minutes') at time zone 'Europe/Istanbul'),
  ('1945', (public.tr_today()::timestamp + interval '19 hours 45 minutes') at time zone 'Europe/Istanbul');

-- ---------------------------------------------------------------------------
-- Şema ve yetki
-- ---------------------------------------------------------------------------
select col_default_is('public', 'tenant_settings', 'distribution_minute', '0', 'distribution_minute varsayılanı 0');
select col_default_is('public', 'tenant_settings', 'summary_minute', '0', 'summary_minute varsayılanı 0');
select throws_ok($$update public.tenant_settings set distribution_minute = 60 where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$,
                 '23514', null, 'distribution_minute 59 üstü reddedilir');
select throws_ok($$update public.tenant_settings set summary_minute = -1 where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$,
                 '23514', null, 'summary_minute negatif reddedilir');
select ok(not has_function_privilege('authenticated', 'public._scheduled_distribution_at(timestamptz)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._scheduled_distribution_at(timestamptz)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public._scheduled_distribution_at(timestamptz)', 'EXECUTE'),
          'iç zamanlanmış dağıtım istemci rollerine kapalı');
select is((select schedule from cron.job where jobname = 'telefoncu-distribution'), '*/5 * * * *',
          'pg_cron dağıtım işi 5 dakikada bir');

-- ---------------------------------------------------------------------------
-- Randevu hatırlatma 09:30 - 60 dk = 08:30
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '0829'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'appointment'),
          0, 'randevu: 08:29 hedef yok');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '0830'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'appointment'),
          1, 'randevu: 08:30 hedef var');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '0845'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'appointment'),
          1, 'randevu: 08:45 hedef var');
insert into public.notification_log (tenant_id, member_id, kind, day, ref_id, status, claimed_at)
values ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'appointment', public.tr_today(), '40000000-0000-4000-8000-0000000000e5', 'sent', (select ts from at_time where label = '0845'));
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '0845'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'appointment'),
          0, 'randevu: gönderildikten sonra gün içinde ikinci kez yok');

-- ---------------------------------------------------------------------------
-- Geri arama 19:30
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1929'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'callback'),
          0, 'geri arama: 19:29 hedef yok');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1930'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'callback'),
          1, 'geri arama: 19:30 hedef var');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1945'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'callback'),
          1, 'geri arama: 19:45 hedef var');
insert into public.notification_log (tenant_id, member_id, kind, day, ref_id, status, claimed_at)
values ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e6', 'sent', (select ts from at_time where label = '1945'));
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1945'))
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'callback'),
          0, 'geri arama: gönderildikten sonra gün içinde ikinci kez yok');

-- ---------------------------------------------------------------------------
-- Zamanlanmış dağıtım 08:30
-- ---------------------------------------------------------------------------
select lives_ok($$select public._scheduled_distribution_at((select ts from at_time where label = '0829'))$$,
                'dağıtım: 08:29 çağrısı çalışır');
select is((select count(*)::int from public.daily_assignments
           where tenant_id = '10000000-0000-4000-8000-0000000000e2' and day = public.tr_today()),
          0, 'dağıtım: 08:29 atama yok');
select lives_ok($$select public._scheduled_distribution_at((select ts from at_time where label = '0830'))$$,
                'dağıtım: 08:30 çağrısı çalışır');
select is((select count(*)::int from public.daily_assignments
           where tenant_id = '10000000-0000-4000-8000-0000000000e2' and day = public.tr_today()),
          2, 'dağıtım: 08:30 iki müşteri atanır');
-- Yeni müşteri gelse de gün içinde ikinci dağıtım yapılmaz
insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e2', 'Kurgu Dakika 4', '05321210004');
select lives_ok($$select public._scheduled_distribution_at((select ts from at_time where label = '0845'))$$,
                'dağıtım: 08:45 çağrısı çalışır');
select is((select count(*)::int from public.daily_assignments
           where tenant_id = '10000000-0000-4000-8000-0000000000e2' and day = public.tr_today()),
          2, 'dağıtım: gün içinde ikinci kez yapılmaz');

select * from finish();
rollback;
