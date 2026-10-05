-- Faz 2: bildirim hedefleri (push, 20261006000100), rapor, dışa aktarma (migration 20261004000800_faz2.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(85);

-- ---------------------------------------------------------------------------
-- Fixture (hepsi kurgusal)
-- Kiracı d1: Yönetici (d1), Zeynep ajan (d2), Deniz ajan view_reports (d3), Burak ajan export (d4)
-- Kiracı d2: Öteki Yönetici (d5)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'f2-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'f2-zey@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated', 'f2-den@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'f2-bur@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated', 'f2-oth@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000d1', 'Faz Iki Kiracı'),
  ('10000000-0000-4000-8000-0000000000d2', 'Öteki Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d2', 'Zeynep Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d3', 'Deniz Ajan', 'agent', '{"view_reports": true}'),
  ('30000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d4', 'Burak Ajan', 'agent', '{"export": true}'),
  ('30000000-0000-4000-8000-0000000000d5', '10000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000d5', 'Öteki Yönetici', 'manager', '{}');

-- Müşteriler: c8 on gün önce oluşturulmuş (new_customers dışında kalır)
insert into public.customers (id, tenant_id, full_name, phone, operator, source_detail, call_status, next_call_at, assigned_to, birth_date, created_at) values
  ('40000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'Ali Bir', '05321240001', 'VF', 'Meta A', 'pending', now(), '30000000-0000-4000-8000-0000000000d2', null, now()),
  ('40000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000d1', 'Can İki', '05321240002', 'VF', 'Meta A', 'retry', now(), '30000000-0000-4000-8000-0000000000d2', null, now()),
  ('40000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d1', 'Efe Üç', '05321240003', 'TC', 'Meta A', 'done', now(), '30000000-0000-4000-8000-0000000000d2', null, now()),
  ('40000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d1', 'Gül Dört', '05321240004', 'TC', 'Meta B', 'pending', now(), '30000000-0000-4000-8000-0000000000d2',
   make_date(1990, extract(month from public.tr_today() + 2)::int, extract(day from public.tr_today() + 2)::int), now()),
  ('40000000-0000-4000-8000-0000000000d5', '10000000-0000-4000-8000-0000000000d1', 'Hale Beş', '05321240005', null, 'Meta B', 'retry', now(), '30000000-0000-4000-8000-0000000000d3', null, now()),
  ('40000000-0000-4000-8000-0000000000d6', '10000000-0000-4000-8000-0000000000d1', 'İpek Altı', '05321240006', null, null, 'pending', now(), '30000000-0000-4000-8000-0000000000d3', null, now()),
  ('40000000-0000-4000-8000-0000000000d7', '10000000-0000-4000-8000-0000000000d1', 'Kaan Yedi', '05321240007', null, null, 'pending', now(), '30000000-0000-4000-8000-0000000000d4', null, now()),
  ('40000000-0000-4000-8000-0000000000d8', '10000000-0000-4000-8000-0000000000d1', 'Lale Sekiz', '05321240008', 'TT', 'Meta A', 'done', now(), null, null, now() - interval '10 days');

-- Bugünkü atamalar: Zeynep d1-d4, Deniz d5-d6, Burak d7; yönetici atamasız
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000d1', public.tr_today(), x.c::uuid, x.m::uuid, x.p
from (values
  ('40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 1),
  ('40000000-0000-4000-8000-0000000000d2', '30000000-0000-4000-8000-0000000000d2', 2),
  ('40000000-0000-4000-8000-0000000000d3', '30000000-0000-4000-8000-0000000000d2', 3),
  ('40000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d2', 4),
  ('40000000-0000-4000-8000-0000000000d5', '30000000-0000-4000-8000-0000000000d3', 1),
  ('40000000-0000-4000-8000-0000000000d6', '30000000-0000-4000-8000-0000000000d3', 2),
  ('40000000-0000-4000-8000-0000000000d7', '30000000-0000-4000-8000-0000000000d4', 1)
) as x(c, m, p);

-- Bugünkü denemeler (7) + üç gün önceki bir deneme (aralık dışı)
insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, created_at) values
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'appointment', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d2', '30000000-0000-4000-8000-0000000000d2', 'no_answer', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d3', '30000000-0000-4000-8000-0000000000d2', 'busy', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d2', 'not_interested', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d5', '30000000-0000-4000-8000-0000000000d3', 'callback', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d6', '30000000-0000-4000-8000-0000000000d3', 'disqualified', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d7', '30000000-0000-4000-8000-0000000000d4', 'wrong_number', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'no_answer', now() - interval '3 days');

-- Huni olayları: d1 tüm aşamalar (completed Zeynep'te), d4 not_interested, d6 rejected; üç gün önce d2 visited
insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, created_at) values
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'appointment', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d1', 'visited', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d1', 'applied', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d1', 'approved', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'completed', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d2', 'not_interested', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d6', '30000000-0000-4000-8000-0000000000d1', 'rejected', now()),
  ('10000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d2', '30000000-0000-4000-8000-0000000000d1', 'visited', now() - interval '3 days');

-- Havuz/ulaşılamadı geçişleri (log_call audit kaydı): bugün 2 havuz + 1 ulaşılamadı, üç gün önce 1 havuz
insert into public.audit_log (tenant_id, member_id, action, entity, entity_id, data, created_at) values
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000d2', '{"call_status":"pool"}', now()),
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000d3', '{"call_status":"pool"}', now()),
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d4', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000d7', '{"call_status":"unreachable"}', now()),
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000d1', '{"call_status":"pool"}', now() - interval '3 days');

-- ---------------------------------------------------------------------------
-- Push geçişi (20261006000100): Telegram bağlama, sabah/hatırlatma/özet hedefleri kalktı.
-- Bu bölüm push varsayılanlarını, yetkileri, geri arama ve randevu hedeflerini sınar.
-- ---------------------------------------------------------------------------
select is((select push_enabled::text || '/' || appointment_lead_minutes
           from public.tenant_settings where tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          'true/60', 'varsayılanlar: push açık, randevu hatırlatma 60 dk');
select is((select notify_callback::text || notify_appointment || notify_morning || notify_summary
           from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          'truetruetruetrue', 'varsayılanlar: bildirim tercihleri açık');

-- ---------------------------------------------------------------------------
-- İç fonksiyonlar istemci rollerine kapalı, push RPC'leri authenticated'a açık
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: _notification_targets authenticated''a kapalı');
select ok(not has_function_privilege('anon', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: _notification_targets anon''a kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_since(text, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._push_name(text)', 'EXECUTE'),
          'yetki: iç bildirim yardımcıları istemciye kapalı');
select ok(has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_finish(bigint, text, text)', 'EXECUTE'),
          'yetki: iç fonksiyonlar service_role''a açık');
select ok(not has_function_privilege('anon', 'public.report_range(date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.log_export(text, int, jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.push_subscribe(text, text, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.push_unsubscribe(text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.push_status()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_push_prefs(boolean, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.push_team_status()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_push_settings(boolean, integer)', 'EXECUTE'),
          'yetki: kullanıcı fonksiyonları anon''a kapalı');
select ok(has_function_privilege('authenticated', 'public.report_range(date, date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.log_export(text, int, jsonb)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.push_subscribe(text, text, text, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.push_unsubscribe(text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.push_status()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_push_prefs(boolean, boolean)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.push_team_status()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_push_settings(boolean, integer)', 'EXECUTE'),
          'yetki: kullanıcı fonksiyonları authenticated''a açık');
select ok(to_regprocedure('public.telegram_create_link_code()') is null
          and to_regprocedure('public.set_notify_prefs(boolean, boolean, boolean)') is null
          and to_regprocedure('public._notification_record(uuid, uuid, text, date, text, text)') is null,
          'Telegram bağlama, eski tercih ve kayıt fonksiyonları yok');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public._notification_targets(now())$$, '42501', null,
                 'yetki: authenticated _notification_targets çağıramaz');
select throws_ok($$select public._notification_claim('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'test', current_date)$$,
                 '42501', null, 'yetki: authenticated _notification_claim çağıramaz');
select throws_ok($$insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth)
                   values ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'https://push.example.test/x', 'a', 'b')$$,
                 '42501', null, 'yetki: üye push_subscriptions''a doğrudan yazamaz');
select throws_ok($$update public.members set notify_callback = false where id = '30000000-0000-4000-8000-0000000000d2'$$,
                 '42501', null, 'yetki: üye bildirim tercihini doğrudan yazamaz');
reset role;

-- ---------------------------------------------------------------------------
-- Bildirim fixture: Zeynep ve Deniz birer cihaz, Burak cihazsız.
-- Geri arama: Can İki (Zeynep), Hale Beş (Deniz), Kaan Yedi (Burak) 5 dakika önce.
-- Randevu: Ali Bir (Zeynep) bugün 12:00.
-- ---------------------------------------------------------------------------
insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'https://push.example.test/f2-zey', repeat('a', 87), repeat('b', 22)),
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d3', 'https://push.example.test/f2-den', repeat('a', 87), repeat('b', 22));
update public.customers set last_outcome = 'callback', next_call_at = now() - interval '5 minutes'
where id in ('40000000-0000-4000-8000-0000000000d2', '40000000-0000-4000-8000-0000000000d5', '40000000-0000-4000-8000-0000000000d7');
update public.customers set pipeline_stage = 'appointment', appointment_day = public.tr_today(), appointment_time = '12:00'
where id = '40000000-0000-4000-8000-0000000000d1';

create temp table at_time (label text primary key, ts timestamptz);
insert into at_time values
  ('1059', (public.tr_today()::timestamp + interval '10 hours 59 minutes') at time zone 'Europe/Istanbul'),
  ('1100', (public.tr_today()::timestamp + interval '11 hours') at time zone 'Europe/Istanbul'),
  ('1130', (public.tr_today()::timestamp + interval '11 hours 30 minutes') at time zone 'Europe/Istanbul'),
  ('1209', (public.tr_today()::timestamp + interval '12 hours 9 minutes') at time zone 'Europe/Istanbul'),
  ('1211', (public.tr_today()::timestamp + interval '12 hours 11 minutes') at time zone 'Europe/Istanbul');
create temp view cb as
  select * from public._notification_targets(now())
  where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'callback';

-- ---------------------------------------------------------------------------
-- callback
-- ---------------------------------------------------------------------------
select is((select string_agg(member_id::text || '>' || ref_id::text, ',' order by member_id) from cb),
          '30000000-0000-4000-8000-0000000000d2>40000000-0000-4000-8000-0000000000d2,30000000-0000-4000-8000-0000000000d3>40000000-0000-4000-8000-0000000000d5',
          'callback: cihazı olan atanmış üyeler, müşteri başına bir satır (Burak cihazsız)');
select is((select payload from cb where member_id = '30000000-0000-4000-8000-0000000000d2'),
          jsonb_build_object('first_name', 'Can', 'last_initial', 'İ',
                             'at', to_char((now() - interval '5 minutes') at time zone 'Europe/Istanbul', 'HH24:MI')),
          'callback: payload ad, soyadın baş harfi ve saat (telefon yok)');
insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d4', 'https://push.example.test/f2-bur', repeat('a', 87), repeat('b', 22));
select is((select count(*)::int from cb where member_id = '30000000-0000-4000-8000-0000000000d4'), 1,
          'callback: cihaz eklenince hedef olur');
delete from public.push_subscriptions where member_id = '30000000-0000-4000-8000-0000000000d4';
update public.members set notify_callback = false where id = '30000000-0000-4000-8000-0000000000d3';
select is((select count(*)::int from cb where member_id = '30000000-0000-4000-8000-0000000000d3'), 0,
          'callback: notify_callback kapalı üye hedef dışı');
update public.members set notify_callback = true where id = '30000000-0000-4000-8000-0000000000d3';
update public.members set is_active = false where id = '30000000-0000-4000-8000-0000000000d3';
select is((select count(*)::int from cb where member_id = '30000000-0000-4000-8000-0000000000d3'), 0,
          'callback: pasif üye hedef dışı');
update public.members set is_active = true where id = '30000000-0000-4000-8000-0000000000d3';
update public.customers set call_status = 'done' where id = '40000000-0000-4000-8000-0000000000d5';
select is((select count(*)::int from cb where ref_id = '40000000-0000-4000-8000-0000000000d5'), 0,
          'callback: kapanmış müşteri hedef dışı');
update public.customers set call_status = 'retry', last_outcome = 'no_answer' where id = '40000000-0000-4000-8000-0000000000d5';
select is((select count(*)::int from cb where ref_id = '40000000-0000-4000-8000-0000000000d5'), 0,
          'callback: son sonuç sonra ara değilse hedef dışı');
update public.customers set last_outcome = 'callback', next_call_at = now() + interval '5 minutes' where id = '40000000-0000-4000-8000-0000000000d5';
select is((select count(*)::int from cb where ref_id = '40000000-0000-4000-8000-0000000000d5'), 0,
          'callback: saati gelmemiş geri arama hedef dışı');
update public.customers set next_call_at = now() - interval '5 minutes' where id = '40000000-0000-4000-8000-0000000000d5';
update public.tenant_settings set push_enabled = false where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where tenant_id = '10000000-0000-4000-8000-0000000000d1')
          + (select count(*)::int from cb),
          0, 'push_enabled kapalı: hiç hedef yok');
update public.tenant_settings set push_enabled = true where tenant_id = '10000000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- appointment (12:00, lead 60)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1059'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'appointment: randevu - lead öncesi hedef yok');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1100'))
           where kind = 'appointment' and member_id = '30000000-0000-4000-8000-0000000000d2'),
          1, 'appointment: randevu - lead anında hedef');
select is((select payload from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and member_id = '30000000-0000-4000-8000-0000000000d2'),
          '{"first_name": "Ali", "last_initial": "B", "time": "12:00"}'::jsonb,
          'appointment: payload ad, soyadın baş harfi ve randevu saati');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1209'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          1, 'appointment: randevudan 9 dakika sonra hâlâ hedef');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1211'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'appointment: randevudan 10 dakikadan fazla geçince hedef yok');
update public.tenant_settings set appointment_lead_minutes = 30 where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1100'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1')::text || '/' ||
          (select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          '0/1', 'appointment: lead 30 iken 11:00 yok, 11:30 var');
update public.tenant_settings set appointment_lead_minutes = 60 where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select throws_ok($$update public.tenant_settings set appointment_lead_minutes = 45 where tenant_id = '10000000-0000-4000-8000-0000000000d1'$$,
                 '23514', null, 'appointment: lead yalnız 30, 60, 120');
update public.members set notify_appointment = false where id = '30000000-0000-4000-8000-0000000000d2';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'appointment: notify_appointment kapalı üye hedef dışı');
update public.members set notify_appointment = true where id = '30000000-0000-4000-8000-0000000000d2';
update public.customers set pipeline_stage = 'visited' where id = '40000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'appointment: randevu aşamasından çıkan müşteri hedef dışı');
update public.customers set pipeline_stage = 'appointment', appointment_day = public.tr_today() + 1 where id = '40000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'appointment: yarınki randevu bugün hedef değil');
update public.customers set appointment_day = public.tr_today() where id = '40000000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- Sahiplenme ve dedup
-- ---------------------------------------------------------------------------
create temp table _c (n text primary key, v bigint);
insert into _c values ('z', public._notification_claim('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2',
                                                       'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000d2'));
select ok((select v from _c where n = 'z') is not null, 'dedup: ilk sahiplenme id döner');
select is((select string_agg(member_id::text, ',') from cb), '30000000-0000-4000-8000-0000000000d3',
          'dedup: sahiplenilen geri arama tekrar dönmez, diğeri kalır');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2',
                                     'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000d2'),
          null::bigint, 'dedup: ikinci sahiplenme null');
select public._notification_finish((select v from _c where n = 'z'), 'sent', null);
select is((select status from public.notification_log where id = (select v from _c where n = 'z')), 'sent', 'dedup: sonuç yazıldı');
insert into public.notification_log (tenant_id, member_id, kind, day, ref_id, status, claimed_at)
values ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'appointment', public.tr_today(),
        '40000000-0000-4000-8000-0000000000d1', 'sent', (select ts from at_time where label = '1100'));
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1130'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'dedup: gönderilmiş randevu hatırlatması tekrar dönmez');
select ok((select indexdef from pg_indexes where indexname = 'notification_log_once_idx') like '%COALESCE(ref_id%',
          'dedup: tekillik indeksi ref_id içerir');
select throws_ok($$insert into public.notification_log (tenant_id, member_id, kind, day, status)
                   values ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'bozuk', current_date, 'sent')$$,
                 '23514', null, 'kayıt: geçersiz tür reddedilir');
select throws_ok($$insert into public.notification_log (tenant_id, member_id, kind, day, status)
                   values ('10000000-0000-4000-8000-0000000000d2', '30000000-0000-4000-8000-0000000000d2', 'test', current_date, 'sent')$$,
                 '23503', null, 'kayıt: üye başka kiracıya ait gösterilemez');

-- notification_log RLS: yönetici okur, ajan okumaz, yazma yok
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.notification_log) >= 2, 'RLS: yönetici notification_log okur');
select throws_ok($$insert into public.notification_log (tenant_id, member_id, kind, day, status)
                   values ('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d1', 'test', current_date, 'sent')$$,
                 '42501', null, 'RLS: yönetici de notification_log''a yazamaz');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.notification_log), 0, 'RLS: ajan notification_log görmez');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.notification_log), 0, 'RLS: başka kiracının yöneticisi göremez');
reset role;

-- ---------------------------------------------------------------------------
-- set_push_prefs, push_status (Zeynep)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select public.set_push_prefs(false, null);
select is(public.push_status(),
          '{"devices": 1, "notify_callback": false, "notify_appointment": true, "push_enabled": true}'::jsonb,
          'push_status: cihaz sayısı, tercihler ve mağaza anahtarı');
select throws_ok($$select * from public.push_team_status()$$, '42501', null, 'push_team_status: ajan çağıramaz');
select throws_ok($$select public.set_push_settings(false, 30)$$, '42501', null, 'set_push_settings: ajan çağıramaz');
reset role;
select is((select notify_callback::text || '/' || notify_appointment from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          'false/true', 'tercih: null alan değişmez, verilen yazılır');
select is((select notify_callback::text from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          'true', 'tercih: başkasının tercihi değişmez');

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select string_agg(full_name || ':' || devices || ':' || notify_callback, ',' order by full_name) from public.push_team_status()),
          'Burak Ajan:0:true,Deniz Ajan:1:true,Kurgu Yönetici:0:true,Zeynep Ajan:1:false',
          'push_team_status: kiracının aktif üyeleri, cihaz sayısı ve tercihleri');
select throws_ok($$select public.set_push_settings(null, 45)$$, '22023', null, 'set_push_settings: geçersiz süre reddedilir');
select lives_ok($$select public.set_push_settings(null, 120)$$, 'set_push_settings: yönetici süreyi değiştirir');
reset role;
select is((select push_enabled::text || '/' || appointment_lead_minutes from public.tenant_settings where tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          'true/120', 'set_push_settings: null alan değişmez');
select ok(exists (select 1 from public.audit_log where action = 'push_settings' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          'set_push_settings: audit satırı yazılır');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.push_team_status()), 1, 'push_team_status: başka kiracı karışmaz');
reset role;

-- ---------------------------------------------------------------------------
-- report_range
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
-- 20261004001100: view_reports'suz ajan reddedilmez, yalnız kendi kapsamını alır (ayrıntı 13_report_scope)
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope') || '/' ||
          (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          'member/1', 'rapor: yetkisiz ajan (yalnız export) yalnız kendi kapsamını görür');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope') || '/' ||
          (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          'member/4', 'rapor: yetkisiz ajan yalnız kendi kapsamını görür');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals'),
          '{"attempts":7,"customers_called":7,"reached":4,"appointments":1,"visited":1,"applied":1,"approved":1,
            "completed":1,"rejected":1,"not_interested":1,"disqualified":1,"pooled":2,"unreachable":1,"new_customers":7,"assigned":7}'::jsonb,
          'rapor: totals bilinen veri kümesinde doğru');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'rates'),
          '{"reach_rate":0.5714,"appointment_rate":0.25,"visit_rate":1,"close_rate":1}'::jsonb,
          'rapor: oranlar 0-1 arası');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_member'),
          jsonb_build_array(
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d4', 'full_name', 'Burak Ajan', 'attempts', 1, 'customers_called', 1, 'reached', 0, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d3', 'full_name', 'Deniz Ajan', 'attempts', 2, 'customers_called', 2, 'reached', 2, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d1', 'full_name', 'Kurgu Yönetici', 'attempts', 0, 'customers_called', 0, 'reached', 0, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d2', 'full_name', 'Zeynep Ajan', 'attempts', 4, 'customers_called', 4, 'reached', 2, 'appointments', 1, 'completed', 1)),
          'rapor: by_member (aktif ajanlar ve hareketi olan üyeler, ada göre)');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_day'),
          jsonb_build_array(jsonb_build_object('day', public.tr_today(), 'attempts', 7, 'reached', 4, 'appointments', 1)),
          'rapor: by_day tek gün');
select is((select jsonb_array_length(public.report_range(public.tr_today() - 3, public.tr_today()) -> 'by_day')),
          4, 'rapor: by_day boş günleri de içerir');
select is((select public.report_range(public.tr_today() - 3, public.tr_today() - 3) -> 'totals' ->> 'attempts'),
          '1', 'rapor: aralık dışı denemeler sayılmaz, aralıktakiler sayılır (3 gün önce)');
select is((select (public.report_range(public.tr_today() - 3, public.tr_today() - 3) -> 'totals' ->> 'visited') || '/' ||
                   (public.report_range(public.tr_today() - 3, public.tr_today() - 3) -> 'totals' ->> 'pooled')),
          '1/1', 'rapor: eski huni olayı ve havuz geçişi kendi gününde sayılır');
select is((select jsonb_array_length(public.report_range(public.tr_today(), public.tr_today()) -> 'by_outcome')),
          7, 'rapor: by_outcome yedi farklı sonuç');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_outcome' -> 0 ->> 'count'),
          '1', 'rapor: by_outcome sayıları');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_source'),
          '[{"source_detail":"Meta A","customers":3,"appointments":1,"completed":1},
            {"source_detail":"Belirtilmemiş","customers":2,"appointments":0,"completed":0},
            {"source_detail":"Meta B","customers":2,"appointments":0,"completed":0}]'::jsonb,
          'rapor: by_source');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_operator'),
          '[{"operator":"Bilinmiyor","customers":3,"completed":0},
            {"operator":"TC","customers":2,"completed":0},
            {"operator":"VF","customers":2,"completed":1}]'::jsonb,
          'rapor: by_operator');
select is((select public.report_range(public.tr_today() + 10, public.tr_today() + 10) -> 'totals' ->> 'attempts'),
          '0', 'rapor: boş aralıkta sıfırlar');
select is((select public.report_range(public.tr_today() + 10, public.tr_today() + 10) -> 'rates'),
          '{"reach_rate":0,"appointment_rate":0,"visit_rate":0,"close_rate":0}'::jsonb,
          'rapor: payda 0 ise oran 0');
select lives_ok($$select public.report_range(public.tr_today() - 365, public.tr_today())$$, 'rapor: 366 gün kabul edilir');
select throws_ok($$select public.report_range(public.tr_today() - 366, public.tr_today())$$,
                 '22023', 'Rapor aralığı en fazla 366 gün olabilir.', 'rapor: 367 gün reddedilir');
select throws_ok($$select public.report_range(public.tr_today(), public.tr_today() - 1)$$,
                 '22023', 'Tarih aralığı geçersiz.', 'rapor: ters aralık reddedilir');
select throws_ok($$select public.report_range(null, public.tr_today())$$,
                 '22023', 'Tarih aralığı geçersiz.', 'rapor: boş tarih reddedilir');
reset role;

-- view_reports yetkili ajan görür; başka kiracının verisi karışmaz
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          '7', 'rapor: view_reports ajanı görür');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          '0', 'rapor: başka kiracının verisi karışmaz');
reset role;

-- ---------------------------------------------------------------------------
-- log_export
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.log_export('customers', 10, '{}')$$,
                 '42501', 'Dışa aktarma yetkiniz yok.', 'export: yetkisiz ajan reddedilir');
reset role;
select is((select count(*)::int from public.audit_log where action = 'export' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'export: reddedilen çağrı audit yazmaz');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.log_export('customers', 42, '{"status":"retry"}')$$, 'export: export yetkili ajan yazar');
select throws_ok($$select public.log_export('', 1, null)$$, '22023', null, 'export: boş tür reddedilir');
select throws_ok($$select public.log_export('customers', -1, null)$$, '22023', null, 'export: negatif satır reddedilir');
reset role;
select is((select data from public.audit_log where action = 'export' and member_id = '30000000-0000-4000-8000-0000000000d4'),
          '{"kind":"customers","rows":42,"filters":{"status":"retry"}}'::jsonb, 'export: audit satırı tür, satır sayısı ve filtreleri taşır');
select is((select entity from public.audit_log where action = 'export' and member_id = '30000000-0000-4000-8000-0000000000d4'),
          'customers', 'export: audit entity türü');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.log_export('report', 7, null)$$, 'export: yönetici yazar');
reset role;
select is((select data from public.audit_log where action = 'export' and member_id = '30000000-0000-4000-8000-0000000000d1'),
          '{"kind":"report","rows":7,"filters":{}}'::jsonb, 'export: filtre verilmezse boş nesne');

select * from finish();
rollback;
