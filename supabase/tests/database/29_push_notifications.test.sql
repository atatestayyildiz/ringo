-- Web Push bildirimleri ve Telegram'ın kaldırılması (migration 20261006000100_push_notifications.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

-- ---------------------------------------------------------------------------
-- Fixture (kurgusal)
-- Kiracı p1: Yönetici (p1), Ece ajan (p2), Onur ajan (p3)
-- Kiracı p2: Başka yönetici (p4)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000ab1', 'authenticated', 'authenticated', 'pn-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000ab2', 'authenticated', 'authenticated', 'pn-ece@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000ab3', 'authenticated', 'authenticated', 'pn-onu@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000ab4', 'authenticated', 'authenticated', 'pn-oth@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000ab1', 'Push Kiracı'),
  ('10000000-0000-4000-8000-000000000ab2', 'Push Başka Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-000000000ab1', '10000000-0000-4000-8000-000000000ab1', '20000000-0000-4000-8000-000000000ab1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-000000000ab2', '10000000-0000-4000-8000-000000000ab1', '20000000-0000-4000-8000-000000000ab2', 'Ece Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000ab3', '10000000-0000-4000-8000-000000000ab1', '20000000-0000-4000-8000-000000000ab3', 'Onur Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000ab4', '10000000-0000-4000-8000-000000000ab2', '20000000-0000-4000-8000-000000000ab4', 'Başka Yönetici', 'manager', '{}');

-- Geri arama (Ece): 10 dakika önce; randevu (Ece): bugün 15:00
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, last_outcome, next_call_at) values
  ('40000000-0000-4000-8000-000000000ab1', '10000000-0000-4000-8000-000000000ab1', 'esra nur ulusoy', '05321290001', '30000000-0000-4000-8000-000000000ab2', 'retry', 'callback', now() - interval '10 minutes');
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, pipeline_stage, appointment_day, appointment_time) values
  ('40000000-0000-4000-8000-000000000ab2', '10000000-0000-4000-8000-000000000ab1', 'Deniz', '05321290002', '30000000-0000-4000-8000-000000000ab2', 'done', 'appointment', public.tr_today(), '15:00');

create temp table at_time (label text primary key, ts timestamptz);
insert into at_time values
  ('1359', (public.tr_today()::timestamp + interval '13 hours 59 minutes') at time zone 'Europe/Istanbul'),
  ('1400', (public.tr_today()::timestamp + interval '14 hours') at time zone 'Europe/Istanbul'),
  ('1510', (public.tr_today()::timestamp + interval '15 hours 10 minutes') at time zone 'Europe/Istanbul');
grant select on at_time to authenticated;

-- ---------------------------------------------------------------------------
-- Şema, RLS, yetkiler
-- ---------------------------------------------------------------------------
select has_table('public', 'push_subscriptions', 'push_subscriptions tablosu var');
select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'push_subscriptions RLS açık');
select col_not_null('public', 'push_subscriptions', 'tenant_id', 'push_subscriptions.tenant_id zorunlu');
select ok((select count(*) from pg_constraint where conrelid = 'public.push_subscriptions'::regclass and contype = 'f'
           and pg_get_constraintdef(oid) like '%REFERENCES members(tenant_id, id) ON DELETE CASCADE%') = 1,
          'member_id FK members(tenant_id, id) on delete cascade');
select ok(exists (select 1 from pg_indexes where tablename = 'push_subscriptions' and indexdef like 'CREATE UNIQUE INDEX%(endpoint)'),
          'endpoint tekil');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
          and not has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE'),
          'authenticated doğrudan yazamaz');
select ok(not has_column_privilege('authenticated', 'public.push_subscriptions', 'p256dh', 'SELECT')
          and not has_column_privilege('authenticated', 'public.push_subscriptions', 'auth', 'SELECT'),
          'p256dh ve auth authenticated''a SELECT edilmez');
select ok(has_column_privilege('authenticated', 'public.push_subscriptions', 'endpoint', 'SELECT')
          and has_column_privilege('authenticated', 'public.push_subscriptions', 'last_seen_at', 'SELECT'),
          'diğer kolonlar okunur');
select ok(not has_table_privilege('anon', 'public.push_subscriptions', 'SELECT')
          and not has_column_privilege('anon', 'public.push_subscriptions', 'endpoint', 'SELECT'),
          'anon push_subscriptions okuyamaz');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
           and proname in ('push_subscribe', 'push_unsubscribe', 'push_status', 'set_push_prefs', 'push_team_status', 'set_push_settings')
           and 'search_path=public, pg_temp' = any (proconfig)),
          6, 'push RPC''leri security definer, search_path = public, pg_temp');
select ok(not has_function_privilege('anon', 'public.push_subscribe(text, text, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.push_status()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_push_settings(boolean, integer)', 'EXECUTE')
          and not has_function_privilege('public', 'public.push_unsubscribe(text)', 'EXECUTE'),
          'anon ve public push RPC''lerini çağıramaz');
select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_done(uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_since(text, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._push_name(text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_finish(bigint, text, text)', 'EXECUTE'),
          'iç (_) fonksiyonlar authenticated''a kapalı');
select ok(has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_finish(bigint, text, text)', 'EXECUTE'),
          'service_role hedef, sahiplenme ve bitirme çağırır');
select is((select string_agg(column_name || ':' || data_type, ',' order by ordinal_position)
           from information_schema.columns where table_schema = 'public' and table_name = 'notification_log' and column_name = 'ref_id'),
          'ref_id:uuid', 'notification_log.ref_id uuid');
select is(pg_get_function_result('public._notification_targets(timestamptz)'::regprocedure),
          'TABLE(tenant_id uuid, member_id uuid, kind text, ref_id uuid, payload jsonb)', '_notification_targets dönüş kolonları');
select is((select push_enabled::text || '/' || appointment_lead_minutes from public.tenant_settings
           where tenant_id = '10000000-0000-4000-8000-000000000ab1'), 'true/60', 'kiracı varsayılanları');

-- ---------------------------------------------------------------------------
-- Telegram nesneleri yok
-- ---------------------------------------------------------------------------
select ok(to_regclass('public.telegram_link_codes') is null and to_regclass('public.telegram_link_attempts') is null,
          'Telegram tabloları yok');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace
           and (proname like '%telegram%' or proname in ('set_notify_prefs', '_notification_record'))),
          0, 'Telegram fonksiyonları, set_notify_prefs ve _notification_record yok');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
           and (column_name like 'telegram%' or column_name in ('reminder_hour', 'notify_reminder'))),
          0, 'Telegram ve hatırlatma kolonları yok');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%telegram%'),
          0, 'hiçbir fonksiyon gövdesi telegram kullanmaz');
select ok(exists (select 1 from cron.job where jobname = 'telefoncu-notify' and command = 'select public._call_notify()'),
          'pg_cron telefoncu-notify işi korunur');

-- ---------------------------------------------------------------------------
-- push_subscribe doğrulamaları (Ece)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.push_subscribe('http://push.example.test/e1', repeat('a', 87), repeat('b', 22))$$,
                 '22023', 'Bildirim adresi geçersiz.', 'http endpoint reddedilir');
select throws_ok($$select public.push_subscribe('https://push.example.test/' || repeat('x', 2030), repeat('a', 87), repeat('b', 22))$$,
                 '22023', 'Bildirim adresi geçersiz.', '2048 karakterden uzun endpoint reddedilir');
select throws_ok($$select public.push_subscribe(null, repeat('a', 87), repeat('b', 22))$$,
                 '22023', 'Bildirim adresi geçersiz.', 'boş endpoint reddedilir');
select throws_ok($$select public.push_subscribe('https://push.example.test/e1', repeat('a', 86) || '+', repeat('b', 22))$$,
                 '22023', 'Bildirim anahtarı geçersiz.', 'base64url olmayan p256dh reddedilir');
select throws_ok($$select public.push_subscribe('https://push.example.test/e1', repeat('a', 20), repeat('b', 22))$$,
                 '22023', 'Bildirim anahtarı geçersiz.', 'kısa p256dh reddedilir');
select throws_ok($$select public.push_subscribe('https://push.example.test/e1', repeat('a', 87), 'kısa')$$,
                 '22023', 'Bildirim anahtarı geçersiz.', 'geçersiz auth reddedilir');
select lives_ok($$select public.push_subscribe('https://push.example.test/e1', repeat('a', 87), repeat('b', 22), repeat('u', 400))$$,
                'geçerli abonelik kaydedilir');
select lives_ok($$select public.push_subscribe('https://push.example.test/e1', repeat('c', 87), repeat('d', 22), 'Kurgu Tarayıcı')$$,
                'aynı endpoint tekrar kaydı hata vermez');
select is((select count(*)::int || '/' || max(user_agent) from public.push_subscriptions), '1/Kurgu Tarayıcı',
          'aynı endpoint tek satır, bilgiler güncellenir');
select throws_ok($$select p256dh from public.push_subscriptions$$, '42501', null, 'ajan kendi p256dh''sini de okuyamaz');
select is((public.push_status() ->> 'devices')::int, 1, 'push_status cihaz sayısı');
reset role;
select is((select length(user_agent) from public.push_subscriptions where endpoint = 'https://push.example.test/e1'
             and p256dh = repeat('c', 87)),
          14, 'anahtarlar güncellendi');

-- user_agent 300'e kırpılır
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab2","role":"authenticated"}', true);
set local role authenticated;
select public.push_subscribe('https://push.example.test/e2', repeat('a', 87), repeat('b', 22), repeat('u', 400));
reset role;
select is((select length(user_agent) from public.push_subscriptions where endpoint = 'https://push.example.test/e2'),
          300, 'user_agent 300 karaktere kırpılır');

-- ---------------------------------------------------------------------------
-- Paylaşılan cihaz: aynı endpoint başka üyeye taşınır (kiracılar arası dahil)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab3","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.push_subscribe('https://push.example.test/e2', repeat('e', 87), repeat('f', 22))$$,
                'Onur aynı cihazı kaydeder');
select is((select count(*)::int from public.push_subscriptions), 1, 'Onur taşınan aboneliği görür');
reset role;
select is((select member_id from public.push_subscriptions where endpoint = 'https://push.example.test/e2'),
          '30000000-0000-4000-8000-000000000ab3'::uuid, 'endpoint çağırana taşındı');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab4","role":"authenticated"}', true);
set local role authenticated;
select public.push_subscribe('https://push.example.test/e2', repeat('e', 87), repeat('f', 22));
reset role;
select is((select tenant_id::text || '/' || member_id from public.push_subscriptions where endpoint = 'https://push.example.test/e2'),
          '10000000-0000-4000-8000-000000000ab2/30000000-0000-4000-8000-000000000ab4', 'başka kiracıya taşınırken kiracı da değişir');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab3","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.push_subscriptions), 0, 'taşınan abonelik eski üyeye görünmez');
select public.push_unsubscribe('https://push.example.test/e1');
reset role;
select is((select member_id from public.push_subscriptions where endpoint = 'https://push.example.test/e1'),
          '30000000-0000-4000-8000-000000000ab2'::uuid, 'push_unsubscribe başkasının satırını silmez');

-- ---------------------------------------------------------------------------
-- Üye başına en çok 10 abonelik (en eskisi silinir)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab3","role":"authenticated"}', true);
set local role authenticated;
select public.push_subscribe('https://push.example.test/o' || i, repeat('a', 87), repeat('b', 22)) from generate_series(1, 11) i;
select is((select count(*)::int from public.push_subscriptions), 10, 'en çok 10 abonelik');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example.test/o1'), 0, 'en eski abonelik silindi');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example.test/o11'), 1, 'en yeni abonelik kaldı');
select lives_ok($$select public.push_unsubscribe('https://push.example.test/o11')$$, 'push_unsubscribe çalışır');
select is((public.push_status() ->> 'devices')::int, 9, 'kendi aboneliği silindi');
reset role;

-- ---------------------------------------------------------------------------
-- Tercihler, ekip durumu, mağaza ayarı: yetki ve kiracı yalıtımı
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab2","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.set_push_prefs(null, false)$$, 'ajan kendi tercihini değiştirir');
select is(public.push_status() - 'devices', '{"notify_callback": true, "notify_appointment": false, "push_enabled": true}'::jsonb,
          'push_status tercihleri yansıtır');
select throws_ok($$select * from public.push_team_status()$$, '42501', null, 'ajan ekip durumunu göremez');
select throws_ok($$select public.set_push_settings(false, null)$$, '42501', null, 'ajan mağaza ayarını değiştiremez');
select public.set_push_prefs(true, true);
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab1","role":"authenticated"}', true);
set local role authenticated;
select is((select string_agg(full_name || ':' || devices, ',' order by full_name) from public.push_team_status()),
          'Ece Ajan:1,Kurgu Yönetici:0,Onur Ajan:9', 'yönetici kendi kiracısının cihaz sayılarını görür');
select is((select count(*)::int from public.push_subscriptions), 0, 'yönetici başkalarının abonelik satırlarını görmez');
select throws_ok($$select public.set_push_settings(true, 90)$$, '22023', null, 'geçersiz hatırlatma süresi reddedilir');
select lives_ok($$select public.set_push_settings(true, 30)$$, 'yönetici süreyi 30 yapar');
select lives_ok($$select public.set_push_settings(true, 60)$$, 'yönetici süreyi 60 yapar');
reset role;
select is((select appointment_lead_minutes::int from public.tenant_settings where tenant_id = '10000000-0000-4000-8000-000000000ab2'),
          60, 'başka kiracının ayarı değişmez');

-- Kilitli panelde RPC'ler çalışmaz
update public.members set locked_at = now() where id = '30000000-0000-4000-8000-000000000ab2';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.push_subscribe('https://push.example.test/k1', repeat('a', 87), repeat('b', 22))$$,
                 '42501', 'Panel kilitli.', 'kilitli panelde push_subscribe çalışmaz');
select throws_ok($$select public.push_status()$$, '42501', 'Panel kilitli.', 'kilitli panelde push_status çalışmaz');
select is((select count(*)::int from public.push_subscriptions), 0, 'kilitli panelde abonelik satırları görünmez');
reset role;
update public.members set locked_at = null where id = '30000000-0000-4000-8000-000000000ab2';

-- anon
set local role anon;
select throws_ok($$select public.push_status()$$, '42501', null, 'anon push_status çağıramaz');
select throws_ok($$select count(*) from public.push_subscriptions$$, '42501', null, 'anon push_subscriptions okuyamaz');
reset role;

-- ---------------------------------------------------------------------------
-- _notification_targets: callback ve appointment
-- ---------------------------------------------------------------------------
select is((select payload from public._notification_targets(now()) where kind = 'callback' and ref_id = '40000000-0000-4000-8000-000000000ab1'),
          jsonb_build_object('first_name', 'esra', 'last_initial', 'U',
                             'at', to_char((now() - interval '10 minutes') at time zone 'Europe/Istanbul', 'HH24:MI')),
          'callback: payload ad ve soyadın baş harfi (büyük), saat');
select is((select count(*)::int from public._notification_targets(now() + interval '36 minutes') where kind = 'callback'
           and tenant_id = '10000000-0000-4000-8000-000000000ab1'),
          0, 'callback: 45 dakikalık pencere dışı');
select is((select string_agg(kind || ':' || ref_id, ',') from public._notification_targets((select ts from at_time where label = '1359'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-000000000ab1'),
          null, 'appointment: 14:00 öncesi yok');
select is((select payload from public._notification_targets((select ts from at_time where label = '1400'))
           where kind = 'appointment' and ref_id = '40000000-0000-4000-8000-000000000ab2'),
          '{"first_name": "Deniz", "last_initial": "", "time": "15:00"}'::jsonb, 'appointment: tek kelimelik adda baş harf boş');
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1510'))
           where kind = 'appointment' and tenant_id = '10000000-0000-4000-8000-000000000ab1'),
          0, 'appointment: randevudan 10 dakika sonra yok');

-- Aboneliği olmayan üyeye dönmez
delete from public.push_subscriptions where member_id = '30000000-0000-4000-8000-000000000ab2';
select is((select count(*)::int from public._notification_targets(now()) where member_id = '30000000-0000-4000-8000-000000000ab2')
          + (select count(*)::int from public._notification_targets((select ts from at_time where label = '1400'))
             where member_id = '30000000-0000-4000-8000-000000000ab2'),
          0, 'aboneliği olmayan üyeye hedef yok');
insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-000000000ab1', '30000000-0000-4000-8000-000000000ab2', 'https://push.example.test/e9', repeat('a', 87), repeat('b', 22));

-- Tercih ve mağaza anahtarı kapalıyken dönmez
update public.members set notify_callback = false where id = '30000000-0000-4000-8000-000000000ab2';
select is((select count(*)::int from public._notification_targets(now()) where kind = 'callback' and member_id = '30000000-0000-4000-8000-000000000ab2'),
          0, 'notify_callback kapalı: callback yok');
update public.members set notify_callback = true, notify_appointment = false where id = '30000000-0000-4000-8000-000000000ab2';
select is((select count(*)::int from public._notification_targets((select ts from at_time where label = '1400'))
           where kind = 'appointment' and member_id = '30000000-0000-4000-8000-000000000ab2'),
          0, 'notify_appointment kapalı: appointment yok');
update public.members set notify_appointment = true where id = '30000000-0000-4000-8000-000000000ab2';
update public.tenant_settings set push_enabled = false where tenant_id = '10000000-0000-4000-8000-000000000ab1';
select is((select count(*)::int from public._notification_targets(now()) where tenant_id = '10000000-0000-4000-8000-000000000ab1'),
          0, 'push_enabled kapalı: hedef yok');
update public.tenant_settings set push_enabled = true where tenant_id = '10000000-0000-4000-8000-000000000ab1';

-- Idempotency: sahiplenilen hedef tekrar dönmez
create temp table _c (n text primary key, v bigint);
insert into _c select 'cb', public._notification_claim(t.tenant_id, t.member_id, t.kind, public.tr_today(), t.ref_id)
from public._notification_targets(now()) t where t.kind = 'callback' and t.ref_id = '40000000-0000-4000-8000-000000000ab1';
select ok((select v from _c where n = 'cb') is not null, 'callback sahiplenildi');
select is((select count(*)::int from public._notification_targets(now()) where kind = 'callback'
           and ref_id = '40000000-0000-4000-8000-000000000ab1'),
          0, 'sahiplenilen callback tekrar dönmez');
select public._notification_finish((select v from _c where n = 'cb'), 'sent', null);
select is((select count(*)::int from public._notification_targets(now() + interval '5 minutes') where kind = 'callback'
           and ref_id = '40000000-0000-4000-8000-000000000ab1'),
          0, 'gönderilen callback sonraki çalışmada da dönmez');

-- anonymize_member abonelikleri siler
update public.members set is_active = false where id = '30000000-0000-4000-8000-000000000ab3';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000ab1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.anonymize_member('30000000-0000-4000-8000-000000000ab3')$$, 'pasif üye silinir');
reset role;
select is((select count(*)::int from public.push_subscriptions where member_id = '30000000-0000-4000-8000-000000000ab3'),
          0, 'silinen üyenin abonelikleri kalmaz');

select * from finish();
rollback;
