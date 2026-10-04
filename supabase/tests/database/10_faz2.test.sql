-- Faz 2: Telegram bağlama, bildirim hedefleri, rapor, dışa aktarma (migration 20261004000800_faz2.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(119);

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
-- Yeni kolon varsayılanları
-- ---------------------------------------------------------------------------
select is((select telegram_enabled::text || '/' || reminder_hour || '/' || coalesce(telegram_bot_username, '-')
           from public.tenant_settings where tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          'false/15/-', 'varsayılanlar: telegram kapalı, hatırlatma 15, kullanıcı adı yok');
select is((select notify_morning::text || notify_reminder || notify_summary || coalesce(telegram_chat_id::text, '-')
           from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          'truetruetrue-', 'varsayılanlar: bildirim tercihleri açık, bağlı değil');

-- ---------------------------------------------------------------------------
-- İç fonksiyonlar istemci rollerine kapalı
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public._telegram_consume_link_code(text, bigint)', 'EXECUTE'),
          'yetki: _telegram_consume_link_code authenticated''a kapalı');
select ok(not has_function_privilege('anon', 'public._telegram_consume_link_code(text, bigint)', 'EXECUTE'),
          'yetki: _telegram_consume_link_code anon''a kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: _notification_targets authenticated''a kapalı');
select ok(not has_function_privilege('anon', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: _notification_targets anon''a kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_record(uuid, uuid, text, date, text, text)', 'EXECUTE'),
          'yetki: _notification_record authenticated''a kapalı');
select ok(not has_function_privilege('anon', 'public._notification_record(uuid, uuid, text, date, text, text)', 'EXECUTE'),
          'yetki: _notification_record anon''a kapalı');
select ok(has_function_privilege('service_role', 'public._telegram_consume_link_code(text, bigint)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_record(uuid, uuid, text, date, text, text)', 'EXECUTE'),
          'yetki: iç fonksiyonlar service_role''a açık');
select ok(not has_function_privilege('anon', 'public.report_range(date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.log_export(text, int, jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.telegram_create_link_code()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.telegram_unlink(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_notify_prefs(boolean, boolean, boolean)', 'EXECUTE'),
          'yetki: kullanıcı fonksiyonları anon''a kapalı');
select ok(has_function_privilege('authenticated', 'public.report_range(date, date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.log_export(text, int, jsonb)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.telegram_create_link_code()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.telegram_unlink(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_notify_prefs(boolean, boolean, boolean)', 'EXECUTE'),
          'yetki: kullanıcı fonksiyonları authenticated''a açık');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public._telegram_consume_link_code('AAAAAAAA', 1)$$, '42501', null,
                 'yetki: authenticated _telegram_consume_link_code çağıramaz');
select throws_ok($$select * from public._notification_targets(now())$$, '42501', null,
                 'yetki: authenticated _notification_targets çağıramaz');
select throws_ok($$select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'test', current_date, 'sent', null)$$,
                 '42501', null, 'yetki: authenticated _notification_record çağıramaz');
select throws_ok($$select * from public.telegram_link_codes$$, '42501', null,
                 'RLS: telegram_link_codes doğrudan okunamaz');
select throws_ok($$update public.members set telegram_chat_id = 5 where id = '30000000-0000-4000-8000-0000000000d2'$$,
                 '42501', null, 'yetki: üye telegram_chat_id alanını doğrudan yazamaz');

-- ---------------------------------------------------------------------------
-- Bağlama kodu üretimi (Zeynep)
-- ---------------------------------------------------------------------------
reset role;
create temp table _codes (n int, code text);
grant all on _codes to authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
insert into _codes select 1, public.telegram_create_link_code();
reset role;

select matches((select code from _codes where n = 1), '^[2-9A-HJ-NP-Z]{8}$', 'kod: 8 karakter, karışmayan alfabe');
select is((select expires_at from public.telegram_link_codes where code = (select code from _codes where n = 1)),
          now() + interval '15 minutes', 'kod: 15 dakika geçerli');
select is((select member_id from public.telegram_link_codes where code = (select code from _codes where n = 1)),
          '30000000-0000-4000-8000-0000000000d2'::uuid, 'kod: çağıran üye için üretilir');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
insert into _codes select 2, public.telegram_create_link_code();
reset role;
select is((select count(*)::int from public.telegram_link_codes where member_id = '30000000-0000-4000-8000-0000000000d2' and used_at is null),
          1, 'kod: yeni kod eski kullanılmamış kodu siler');
select isnt((select code from _codes where n = 2), (select code from _codes where n = 1), 'kod: yeni kod farklı');
select is((select count(*)::int from public.telegram_link_codes where code = (select code from _codes where n = 1)),
          0, 'kod: eski kod artık yok');

-- ---------------------------------------------------------------------------
-- Kodun tüketilmesi
-- ---------------------------------------------------------------------------
select is((select public._telegram_consume_link_code((select code from _codes where n = 2), 1001) ->> 'ok'),
          'true', 'tüketim: geçerli kod kabul edilir');
select is((select public._telegram_consume_link_code((select code from _codes where n = 2), 1001) ->> 'reason'),
          'used', 'tüketim: kod tek kullanımlık');
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          1001::bigint, 'tüketim: chat_id üyeye yazıldı');
select ok((select telegram_linked_at from public.members where id = '30000000-0000-4000-8000-0000000000d2') is not null,
          'tüketim: telegram_linked_at dolu');
select is((select public._telegram_consume_link_code('ZZZZZZZZ', 9) ->> 'reason'),
          'invalid', 'tüketim: bilinmeyen kod invalid');
select is((select public._telegram_consume_link_code(null, 9) ->> 'reason'),
          'invalid', 'tüketim: boş kod invalid');

insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('EXPRED22', '10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d3', now() - interval '1 minute');
select is((select public._telegram_consume_link_code('EXPRED22', 1002) ->> 'reason'),
          'expired', 'tüketim: süresi geçmiş kod expired');
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          null::bigint, 'tüketim: süresi geçmiş kodla bağlanılmaz');

-- Başka chat bağlıyken yeniden bağlama: chat güncellenir
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('REBND222', '10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', now() + interval '10 minutes');
select is((select public._telegram_consume_link_code('rebnd222', 2001) ->> 'full_name'),
          'Zeynep Ajan', 'yeniden bağlama: küçük harf kod kabul edilir, ad döner');
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          2001::bigint, 'yeniden bağlama: üye yeni chat''e taşındı');

-- Aynı chat başka üyeye bağlanırsa önceki üyenin bağlantısı kalkar
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('STEAL222', '10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d3', now() + interval '10 minutes');
select is((select public._telegram_consume_link_code('STEAL222', 2001) ->> 'tenant_name'),
          'Faz Iki Kiracı', 'chat devri: kiracı adı döner');
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          null::bigint, 'chat devri: önceki üyenin bağlantısı kalktı');
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          2001::bigint, 'chat devri: yeni üye bağlandı');
select is((select count(*)::int from public.audit_log where action = 'telegram_link' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          3, 'tüketim: her başarılı bağlama audit satırı yazar');

-- Pasif üyenin kodu tüketilemez
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('PASF2222', '10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d4', now() + interval '10 minutes');
update public.members set is_active = false where id = '30000000-0000-4000-8000-0000000000d4';
select is((select public._telegram_consume_link_code('PASF2222', 3001) ->> 'reason'),
          'invalid', 'tüketim: pasif üye için kod invalid');
update public.members set is_active = true where id = '30000000-0000-4000-8000-0000000000d4';

-- ---------------------------------------------------------------------------
-- Bildirim fixture: bağlantılar ve ayar
-- Zeynep 1001, Deniz 1002, Yönetici 1003; Burak bağlı değil
-- ---------------------------------------------------------------------------
update public.members set telegram_chat_id = 1001, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000d2';
update public.members set telegram_chat_id = 1002, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000d3';
update public.members set telegram_chat_id = 1003, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000d1';
update public.tenant_settings set telegram_enabled = true where tenant_id = '10000000-0000-4000-8000-0000000000d1';

-- ---------------------------------------------------------------------------
-- _notification_targets: morning (saat 08)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          2, 'morning: bağlı ve atamalı iki üye hedef (yönetici atamasız, Burak bağlı değil)');
select is((select payload::text from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'morning'),
          jsonb_build_object('first_name', 'Zeynep', 'total', 4, 'retries', 1, 'new', 2,
                             'birthdays', jsonb_build_array(jsonb_build_object('full_name', 'Gül Dört', 'days_left', 2)))::text,
          'morning: payload alanları (ad, toplam, tekrar, yeni, doğum günü)');
select is((select chat_id from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d3' and kind = 'morning'),
          1002::bigint, 'morning: chat_id döner');
select is((select payload -> 'birthdays' from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d3' and kind = 'morning'),
          '[]'::jsonb, 'morning: doğum günü yoksa boş liste');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'saat: hiçbir ayar saatiyle eşleşmeyen saatte hedef yok');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours 59 minutes') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          2, 'saat: 08:59 hâlâ 08 saati sayılır (Europe/Istanbul)');

-- distribution_hour değişince morning saati de değişir
update public.tenant_settings set distribution_hour = 10 where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          0, 'saat: morning distribution_hour''a bağlı (08 artık eşleşmez)');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          2, 'saat: morning yeni distribution_hour''da hedef verir');
update public.tenant_settings set distribution_hour = 8 where tenant_id = '10000000-0000-4000-8000-0000000000d1';

-- tercih kapalı
update public.members set notify_morning = false where id = '30000000-0000-4000-8000-0000000000d3';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          1, 'tercih: notify_morning kapalı üye hedef dışı');
update public.members set notify_morning = true where id = '30000000-0000-4000-8000-0000000000d3';

-- bağlı olmayan: Burak atamalı ama chat yok; bağlanırsa hedef olur
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d4'),
          0, 'bağlı olmayan: chat_id boş üye hedef dışı');
update public.members set telegram_chat_id = 1004 where id = '30000000-0000-4000-8000-0000000000d4';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d4' and kind = 'morning'),
          1, 'bağlı olmayan: bağlanınca hedef olur');
update public.members set telegram_chat_id = null where id = '30000000-0000-4000-8000-0000000000d4';

-- pasif üye
update public.members set is_active = false where id = '30000000-0000-4000-8000-0000000000d3';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d3'),
          0, 'pasif üye hedef dışı');
update public.members set is_active = true where id = '30000000-0000-4000-8000-0000000000d3';

-- telegram_enabled kapalı
update public.tenant_settings set telegram_enabled = false where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          0, 'telegram_enabled kapalı: hiç hedef yok');
update public.tenant_settings set telegram_enabled = true where tenant_id = '10000000-0000-4000-8000-0000000000d1';

-- total 0: Zeynep'in atamaları kalkarsa hedef yok
update public.daily_assignments set member_id = '30000000-0000-4000-8000-0000000000d3'
where member_id = '30000000-0000-4000-8000-0000000000d2' and day = public.tr_today();
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d2'),
          0, 'total 0: atamasız üyeye morning hedefi yok');
update public.daily_assignments set member_id = '30000000-0000-4000-8000-0000000000d2'
where customer_id in ('40000000-0000-4000-8000-0000000000d1', '40000000-0000-4000-8000-0000000000d2',
                      '40000000-0000-4000-8000-0000000000d3', '40000000-0000-4000-8000-0000000000d4')
  and day = public.tr_today();

-- ---------------------------------------------------------------------------
-- reminder (saat 15) ve summary (saat 19)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '15 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'reminder'),
          2, 'reminder: retry''ı olan iki üye (Zeynep, Deniz)');
select is((select payload::text from public._notification_targets((public.tr_today()::timestamp + interval '15 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'reminder'),
          jsonb_build_object('first_name', 'Zeynep', 'retry_count', 1)::text, 'reminder: payload');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '15 hours') at time zone 'Europe/Istanbul')
           where kind = 'morning' or kind = 'summary'),
          0, 'reminder saatinde başka tür hedef yok');
update public.customers set call_status = 'done' where id = '40000000-0000-4000-8000-0000000000d5';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '15 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d3'),
          0, 'reminder: retry sayısı 0 ise hedef yok');
update public.customers set call_status = 'retry' where id = '40000000-0000-4000-8000-0000000000d5';
update public.tenant_settings set reminder_hour = 16 where tenant_id = '10000000-0000-4000-8000-0000000000d1';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '16 hours') at time zone 'Europe/Istanbul')
           where kind = 'reminder' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          2, 'reminder: reminder_hour ayarına uyar');
update public.tenant_settings set reminder_hour = 15 where tenant_id = '10000000-0000-4000-8000-0000000000d1';

select is((select string_agg(member_id::text, ',' order by member_id) from public._notification_targets((public.tr_today()::timestamp + interval '19 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'summary'),
          '30000000-0000-4000-8000-0000000000d1,30000000-0000-4000-8000-0000000000d3',
          'summary: yalnız yönetici ve view_reports üyesi (Zeynep dışarıda)');
select is((select payload -> 'totals' from public._notification_targets((public.tr_today()::timestamp + interval '19 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d1' and kind = 'summary'),
          '{"assigned": 7, "done": 1, "reached": 4, "appointments": 1, "retries": 2}'::jsonb, 'summary: toplamlar');
select is((select payload ->> 'day' from public._notification_targets((public.tr_today()::timestamp + interval '19 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d1' and kind = 'summary'),
          public.tr_today()::text, 'summary: gün alanı');
select is((select payload -> 'members' from public._notification_targets((public.tr_today()::timestamp + interval '19 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000d1' and kind = 'summary'),
          '[{"full_name":"Burak Ajan","assigned":1,"done":0,"appointments":0},
            {"full_name":"Deniz Ajan","assigned":2,"done":0,"appointments":0},
            {"full_name":"Zeynep Ajan","assigned":4,"done":1,"appointments":1}]'::jsonb,
          'summary: ekip satırları ada göre');
update public.members set notify_summary = false where id = '30000000-0000-4000-8000-0000000000d3';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '19 hours') at time zone 'Europe/Istanbul')
           where kind = 'summary' and tenant_id = '10000000-0000-4000-8000-0000000000d1'),
          1, 'summary: notify_summary kapalı üye hedef dışı');
update public.members set notify_summary = true where id = '30000000-0000-4000-8000-0000000000d3';

-- ---------------------------------------------------------------------------
-- _notification_record ve dedup
-- ---------------------------------------------------------------------------
select lives_ok($$select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'morning', public.tr_today(), 'sent', null)$$,
                'kayıt: _notification_record yazar');
select is((select count(*)::int from public.notification_log where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'morning'),
          1, 'kayıt: satır oluştu');
select lives_ok($$select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'morning', public.tr_today(), 'failed', 'x')$$,
                'kayıt: aynı gün aynı tür ikinci kez hata vermez');
select is((select count(*)::int from public.notification_log where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'morning'),
          1, 'kayıt: aynı gün aynı tür ikinci satır yazılmaz');
select is((select status from public.notification_log where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'morning'),
          'sent', 'kayıt: ilk kayıt korunur');
select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'test', public.tr_today(), 'sent', null);
select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'test', public.tr_today(), 'failed', 'ağ hatası');
select is((select count(*)::int from public.notification_log where member_id = '30000000-0000-4000-8000-0000000000d2' and kind = 'test'),
          2, 'kayıt: test türü tekrar edebilir');
select throws_ok($$select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d2', 'summary', public.tr_today(), 'bozuk', null)$$,
                 '23514', null, 'kayıt: geçersiz durum reddedilir');
select throws_ok($$select public._notification_record('10000000-0000-4000-8000-0000000000d2', '30000000-0000-4000-8000-0000000000d2', 'summary', public.tr_today(), 'sent', null)$$,
                 '23503', null, 'kayıt: üye başka kiracıya ait gösterilemez');

-- dedup: Zeynep'in morning kaydı var, Deniz'inki yok
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          1, 'dedup: kaydı olan üyeye aynı gün tekrar gönderilmez');
select is((select member_id from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          '30000000-0000-4000-8000-0000000000d3'::uuid, 'dedup: kalan hedef Deniz');
select public._notification_record('10000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-0000000000d3', 'morning', public.tr_today(), 'failed', 'ağ hatası');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '8 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'morning'),
          0, 'dedup: failed kaydı da yeniden denemeyi engeller');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '15 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000d1' and kind = 'reminder'),
          2, 'dedup: morning kaydı reminder''ı etkilemez');

-- notification_log RLS: yönetici okur, ajan okumaz, yazma yok
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select ok((select count(*) from public.notification_log) >= 3, 'RLS: yönetici notification_log okur');
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
-- set_notify_prefs (Zeynep)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select public.set_notify_prefs(false, null, false);
reset role;
select is((select notify_morning::text || '/' || notify_reminder || '/' || notify_summary from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          'false/true/false', 'tercih: null alan değişmez, verilenler yazılır');
select is((select notify_morning::text from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          'true', 'tercih: başkasının tercihi değişmez');

-- ---------------------------------------------------------------------------
-- telegram_unlink
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.telegram_unlink('30000000-0000-4000-8000-0000000000d3')$$,
                 '42501', null, 'unlink: ajan başkasının bağlantısını kaldıramaz');
reset role;
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          1002::bigint, 'unlink: reddedilen çağrı bağlantıyı korur');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.telegram_unlink()$$, 'unlink: ajan kendi bağlantısını kaldırır');
select lives_ok($$select public.telegram_unlink('30000000-0000-4000-8000-0000000000d2')$$, 'unlink: ajan kendi id''siyle de kaldırır');
reset role;
select is((select telegram_chat_id::text || coalesce(telegram_linked_at::text, '') from public.members where id = '30000000-0000-4000-8000-0000000000d2'),
          null, 'unlink: chat_id ve telegram_linked_at temizlendi');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d5","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.telegram_unlink('30000000-0000-4000-8000-0000000000d3')$$,
                 'P0002', null, 'unlink: başka kiracının yöneticisi üyeyi bulamaz');
reset role;
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          1002::bigint, 'unlink: kiracılar arası kaldırma yapılmadı');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.telegram_unlink('30000000-0000-4000-8000-0000000000d3')$$, 'unlink: yönetici başkasınınkini kaldırır');
reset role;
select is((select telegram_chat_id from public.members where id = '30000000-0000-4000-8000-0000000000d3'),
          null::bigint, 'unlink: yönetici kaldırması etkili');
select ok((select count(*) from public.audit_log where action = 'telegram_unlink' and tenant_id = '10000000-0000-4000-8000-0000000000d1') >= 3,
          'unlink: audit satırı yazılır');

-- ---------------------------------------------------------------------------
-- report_range
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.report_range(public.tr_today(), public.tr_today())$$,
                 '42501', 'Raporları görme yetkiniz yok.', 'rapor: yetkisiz ajan (yalnız export) reddedilir');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.report_range(public.tr_today(), public.tr_today())$$,
                 '42501', 'Raporları görme yetkiniz yok.', 'rapor: yetkisiz ajan reddedilir');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals'),
          '{"attempts":7,"customers_called":7,"reached":4,"appointments":1,"visited":1,"applied":1,"approved":1,
            "completed":1,"rejected":1,"not_interested":1,"disqualified":1,"pooled":2,"unreachable":1,"new_customers":7}'::jsonb,
          'rapor: totals bilinen veri kümesinde doğru');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'rates'),
          '{"reach_rate":0.5714,"appointment_rate":0.25,"visit_rate":1,"close_rate":1}'::jsonb,
          'rapor: oranlar 0-1 arası');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_member'),
          jsonb_build_array(
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d4', 'full_name', 'Burak Ajan', 'attempts', 1, 'reached', 0, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d3', 'full_name', 'Deniz Ajan', 'attempts', 2, 'reached', 2, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d1', 'full_name', 'Kurgu Yönetici', 'attempts', 0, 'reached', 0, 'appointments', 0, 'completed', 0),
            jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000d2', 'full_name', 'Zeynep Ajan', 'attempts', 4, 'reached', 2, 'appointments', 1, 'completed', 1)),
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
select is((select count(*)::int from public.audit_log where action = 'export'), 0, 'export: reddedilen çağrı audit yazmaz');

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
