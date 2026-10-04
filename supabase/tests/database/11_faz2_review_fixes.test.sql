-- Faz 2 inceleme düzeltmeleri (migration 20261004000900_faz2_review_fixes.sql)
-- O1 (>= saat, kaçan dağıtım), D3 (sahiplen/gönder/bitir, yeniden deneme), D4 (bağlama deneme sınırı),
-- D5 (test mesajı dakikada 1), D2 (members insert kolon yetkisi)
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- ---------------------------------------------------------------------------
-- Fixture (kurgusal)
-- Kiracı e1: Yönetici (e1), Selin ajan (e2); bugün atamalı, Telegram açık
-- Kiracı e2: Mert ajan (e3); bugün hiç atama yok, Telegram açık (kaçan dağıtım senaryosu)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'rf-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'rf-sel@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'rf-mer@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e4', 'authenticated', 'authenticated', 'rf-new@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Düzeltme Kiracı'),
  ('10000000-0000-4000-8000-0000000000e2', 'Kaçan Dağıtım Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Selin Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e3', 'Mert Ajan', 'agent', '{}');

insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Ada Bir', '05321250001', 'pending', now(), '30000000-0000-4000-8000-0000000000e2'),
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', 'Bora İki', '05321250002', 'retry', now(), '30000000-0000-4000-8000-0000000000e2'),
  ('40000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e2', 'Cem Üç', '05321250003', 'pending', now() - interval '1 hour', null),
  ('40000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e2', 'Duru Dört', '05321250004', 'pending', now() - interval '1 hour', null);

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 1),
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 2);

update public.members set telegram_chat_id = 5001, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000e1';
update public.members set telegram_chat_id = 5002, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000e2';
update public.members set telegram_chat_id = 5003, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000e3';
update public.tenant_settings
set telegram_enabled = true, distribution_mode = 'auto_even', distribution_hour = 8, reminder_hour = 15, summary_hour = 19
where tenant_id in ('10000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e2');

create temp table _t (n text primary key, v bigint) on commit drop;

-- ---------------------------------------------------------------------------
-- Şema ve yetkiler
-- ---------------------------------------------------------------------------
select has_column('public', 'notification_log', 'attempts', 'şema: notification_log.attempts');
select has_column('public', 'notification_log', 'claimed_at', 'şema: notification_log.claimed_at');
select has_table('public', 'telegram_link_attempts', 'şema: telegram_link_attempts');
select ok((select relrowsecurity from pg_class where oid = 'public.telegram_link_attempts'::regclass), 'şema: telegram_link_attempts RLS açık');
select ok(not has_table_privilege('authenticated', 'public.telegram_link_attempts', 'SELECT')
          and not has_table_privilege('authenticated', 'public.telegram_link_attempts', 'INSERT')
          and not has_table_privilege('anon', 'public.telegram_link_attempts', 'SELECT'),
          'yetki: telegram_link_attempts istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_claim(uuid, uuid, text, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_claim(uuid, uuid, text, date)', 'EXECUTE'),
          'yetki: _notification_claim istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_finish(bigint, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_finish(bigint, text, text)', 'EXECUTE'),
          'yetki: _notification_finish istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_done(uuid, text, date)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._telegram_link_limited(bigint)', 'EXECUTE'),
          'yetki: yardımcı iç fonksiyonlar authenticated''a kapalı');
select ok(has_function_privilege('service_role', 'public._notification_claim(uuid, uuid, text, date)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_finish(bigint, text, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._telegram_consume_link_code(text, bigint)', 'EXECUTE'),
          'yetki: service_role iç fonksiyonları çağırır');
select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._telegram_consume_link_code(text, bigint)', 'EXECUTE'),
          'yetki: yeniden tanımlanan iç fonksiyonlar authenticated''a kapalı');

-- D2: members INSERT kolon yetkisi
select ok(not has_column_privilege('authenticated', 'public.members', 'telegram_chat_id', 'INSERT')
          and not has_column_privilege('authenticated', 'public.members', 'telegram_linked_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.members', 'notify_morning', 'INSERT'),
          'D2: authenticated telegram/notify kolonlarına insert yetkisi yok');
select ok(has_column_privilege('authenticated', 'public.members', 'full_name', 'INSERT')
          and has_column_privilege('authenticated', 'public.members', 'user_id', 'INSERT'),
          'D2: yönetimsel kolonlara insert yetkisi sürüyor');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.members (tenant_id, user_id, full_name, role, telegram_chat_id, telegram_linked_at)
                   values ('10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Yeni Kişi', 'agent', 4242, now())$$,
                 '42501', null, 'D2: yönetici insert ile chat id yazamaz');
select lives_ok($$insert into public.members (tenant_id, user_id, full_name, role)
                  values ('10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Yeni Kişi', 'agent')$$,
                'D2: yönetici chat id olmadan üye ekleyebilir');
select throws_ok($$update public.members set telegram_chat_id = 4242 where user_id = '20000000-0000-4000-8000-0000000000e4'$$,
                 '42501', null, 'D2: yönetici update ile de chat id yazamaz');
reset role;
-- Yeni ajanın etkisi olmasın (summary ekip satırları vb.)
delete from public.members where user_id = '20000000-0000-4000-8000-0000000000e4';

-- ---------------------------------------------------------------------------
-- O1: saat koşulu ">= ayar saati"
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '7 hours 59 minutes') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000e1'),
          0, 'O1: dağıtım saatinden önce hedef yok');
select is((select count(*)::int from public.daily_assignments where tenant_id = '10000000-0000-4000-8000-0000000000e2'),
          0, 'O1: dağıtım saatinden önce kaçan dağıtım tetiklenmez');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours 30 minutes') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          1, 'O1: dağıtım saatinden 2 saat sonra morning hâlâ hedef');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '14 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'reminder'),
          0, 'O1: reminder saatinden önce reminder yok');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'reminder'),
          1, 'O1: reminder saatinden sonra reminder hedef');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '18 hours 59 minutes') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'summary'),
          0, 'O1: summary saatinden önce summary yok');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '22 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e1' and kind = 'summary'),
          1, 'O1: summary saatinden sonra yöneticiye summary hedef');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '22 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          1, 'O1: morning gün sonuna kadar yakalanır');

-- Kaçan dağıtım: e2'de bugün atama yoktu; saat geçince hedef hesaplanırken dağıtılır
select is((select payload ->> 'total' from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e3' and kind = 'morning'),
          '2', 'O1: atama yoksa önce dağıtım yapılır, morning hedefi atamaları içerir');
select is((select count(*)::int from public.daily_assignments
           where tenant_id = '10000000-0000-4000-8000-0000000000e2' and day = public.tr_today()),
          2, 'O1: kaçan dağıtım bugünün atamalarını yazdı');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e3' and kind = 'morning'),
          1, 'O1: ikinci çağrı tekrar dağıtmaz (idempotent), hedef aynı');
select is((select count(*)::int from public.daily_assignments
           where tenant_id = '10000000-0000-4000-8000-0000000000e2' and day = public.tr_today()),
          2, 'O1: ikinci çağrıda atama sayısı değişmez');

-- Telegram kapalı kiracıda kaçan dağıtım tetiklenmez
update public.tenant_settings set telegram_enabled = false where tenant_id = '10000000-0000-4000-8000-0000000000e2';
delete from public.daily_assignments where tenant_id = '10000000-0000-4000-8000-0000000000e2';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where tenant_id = '10000000-0000-4000-8000-0000000000e2'),
          0, 'O1: telegram kapalı kiracıya hedef yok');
select is((select count(*)::int from public.daily_assignments where tenant_id = '10000000-0000-4000-8000-0000000000e2'),
          0, 'O1: telegram kapalı kiracıda bildirim dağıtım tetiklemez');
update public.tenant_settings set telegram_enabled = true where tenant_id = '10000000-0000-4000-8000-0000000000e2';

-- ---------------------------------------------------------------------------
-- D3: sahiplen, gönder, bitir
-- ---------------------------------------------------------------------------
insert into _t values ('c1', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()));
select ok((select v from _t where n = 'c1') is not null, 'D3: ilk sahiplenme id döner');
select is((select status || '/' || attempts from public.notification_log where id = (select v from _t where n = 'c1')),
          'sending/1', 'D3: satır sending, attempts 1');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()),
          null::bigint, 'D3: ikinci sahiplenme null (çift gönderim yok)');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          0, 'D3: taze sending kaydı hedef dışı');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()),
          null::bigint, 'D3: başka kiracı adına sahiplenilemez');

-- Yarım kalmış sending (10 dakikadan eski) yeniden sahiplenilir
update public.notification_log set claimed_at = now() - interval '11 minutes' where id = (select v from _t where n = 'c1');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          1, 'D3: 10 dakikadan eski sending yeniden hedef');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()),
          (select v from _t where n = 'c1'), 'D3: eski sending aynı satırla yeniden sahiplenilir');
select is((select attempts from public.notification_log where id = (select v from _t where n = 'c1')), 2, 'D3: attempts 2');

-- Başarısız: hedef geri döner, üçüncü denemeden sonra durur
select lives_ok($$select public._notification_finish((select v from _t where n = 'c1'), 'failed', 'Telegram hatası 502')$$, 'D3: finish failed');
select is((select status || '/' || coalesce(error, '-') from public.notification_log where id = (select v from _t where n = 'c1')),
          'failed/Telegram hatası 502', 'D3: hata ve durum yazıldı');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          1, 'D3: failed (attempts < 3) yeniden hedef');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()),
          (select v from _t where n = 'c1'), 'D3: failed yeniden sahiplenilir');
select is((select status || '/' || attempts || '/' || coalesce(error, '-') from public.notification_log where id = (select v from _t where n = 'c1')),
          'sending/3/-', 'D3: attempts 3, hata temizlendi');
select public._notification_finish((select v from _t where n = 'c1'), 'failed', 'yine hata');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'morning'),
          0, 'D3: 3 deneme sonrası hedef dışı');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today()),
          null::bigint, 'D3: 3 deneme sonrası sahiplenilemez');

-- Başarı: hedef dışı, finish yalnız sending satırı değiştirir
insert into _t values ('c2', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'reminder', public.tr_today()));
select public._notification_finish((select v from _t where n = 'c2'), 'sent', null);
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'reminder'),
          0, 'D3: sent kaydı hedef dışı');
select public._notification_finish((select v from _t where n = 'c2'), 'failed', 'geç gelen');
select is((select status from public.notification_log where id = (select v from _t where n = 'c2')),
          'sent', 'D3: bitmiş satır ikinci finish ile değişmez');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'reminder', public.tr_today()),
          null::bigint, 'D3: sent sonrası sahiplenilemez');
select throws_ok($$select public._notification_finish((select v from _t where n = 'c2'), 'sending', null)$$,
                 '22023', null, 'D3: finish geçersiz durumu reddeder');
select throws_ok($$select public._notification_claim(null, '30000000-0000-4000-8000-0000000000e2', 'morning', public.tr_today())$$,
                 '22023', null, 'D3: eksik parametre 22023');

-- ---------------------------------------------------------------------------
-- D5: test mesajı üye başına dakikada 1
-- ---------------------------------------------------------------------------
insert into _t values ('t1', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'test', public.tr_today()));
select ok((select v from _t where n = 't1') is not null, 'D5: ilk test sahiplenmesi id döner');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'test', public.tr_today()),
          null::bigint, 'D5: bir dakika içinde ikinci test reddedilir');
select ok(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e1', 'test', public.tr_today()) is not null,
          'D5: sınır üye başına (başka üye etkilenmez)');
update public.notification_log set claimed_at = now() - interval '61 seconds' where id = (select v from _t where n = 't1');
select ok(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'test', public.tr_today())
            is distinct from (select v from _t where n = 't1'),
          'D5: bir dakika sonra yeni test satırı açılır');
select throws_ok($$select public._notification_claim('10000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 'test', public.tr_today())$$,
                 'P0002', null, 'D5: başka kiracının üyesi için test sahiplenilemez');

-- ---------------------------------------------------------------------------
-- D4: bağlama kodu deneme sınırı
-- ---------------------------------------------------------------------------
select is((select string_agg(public._telegram_consume_link_code('YANLIS22', 7001) ->> 'reason', ',') from generate_series(1, 5)),
          'invalid,invalid,invalid,invalid,invalid', 'D4: ilk 5 başarısız deneme normal yanıt alır');
select is((select count(*)::int from public.telegram_link_attempts where chat_id = 7001), 5, 'D4: başarısız denemeler sayılır');
select is(public._telegram_consume_link_code('YANLIS22', 7001) ->> 'reason', 'rate_limited', 'D4: 6. deneme rate_limited');
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('DGRU2222', '10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e1', now() + interval '10 minutes');
select is(public._telegram_consume_link_code('DGRU2222', 7001) ->> 'reason', 'rate_limited', 'D4: sınırdaki sohbet geçerli kodla da bağlanamaz');
select is((select used_at from public.telegram_link_codes where code = 'DGRU2222'), null::timestamptz, 'D4: kod tüketilmedi');
select is(public._telegram_consume_link_code('YANLIS22', 7002) ->> 'reason', 'invalid', 'D4: sınır sohbet başına');
update public.telegram_link_attempts set at = now() - interval '61 minutes' where chat_id = 7001;
select is(public._telegram_consume_link_code('DGRU2222', 7001) ->> 'ok', 'true', 'D4: bir saat sonra sohbet tekrar deneyebilir');
insert into public.telegram_link_attempts (chat_id, at) values (7003, now() - interval '25 hours');
select public._telegram_consume_link_code('YANLIS22', 7004);
select is((select count(*)::int from public.telegram_link_attempts where at < now() - interval '24 hours'),
          0, 'D4: 24 saatten eski deneme kayıtları temizlenir');

select * from finish();
rollback;
