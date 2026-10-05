-- Faz 2 inceleme düzeltmeleri (migration 20261004000900_faz2_review_fixes.sql)
-- D3 (sahiplen/gönder/bitir, yeniden deneme), D5 (test mesajı dakikada 1), D2 (members insert kolon yetkisi).
-- Push geçişiyle (20261006000100): O1 saat koşulu geri arama penceresine, D3 ref_id'li sahiplenmeye çevrildi;
-- D4 (Telegram bağlama deneme sınırı) Telegram ile birlikte kalktı.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- ---------------------------------------------------------------------------
-- Fixture (kurgusal)
-- Kiracı e1: Yönetici (e1), Selin ajan (e2, iki geri arama müşterisi, bir cihaz), push açık
-- Kiracı e2: Mert ajan (e3)
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

-- Geri arama zamanları şimdiye göre (sahiplenme zamanı now() ile tutarlı olsun)
insert into public.customers (id, tenant_id, full_name, phone, call_status, last_outcome, next_call_at, assigned_to) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Ada Bir', '05321250001', 'pending', 'callback', now() - interval '10 minutes', '30000000-0000-4000-8000-0000000000e2'),
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', 'Bora İki', '05321250002', 'retry', 'callback', now() - interval '30 minutes', '30000000-0000-4000-8000-0000000000e2');

insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'https://push.example.test/rf-1', repeat('a', 87), repeat('b', 22));
update public.tenant_settings
set push_enabled = true, distribution_mode = 'auto_even', distribution_hour = 8, summary_hour = 19
where tenant_id in ('10000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e2');

create temp table _t (n text primary key, v bigint) on commit drop;
create temp view _cb as
  select * from public._notification_targets(now())
  where member_id = '30000000-0000-4000-8000-0000000000e2' and kind = 'callback'
    and ref_id = '40000000-0000-4000-8000-0000000000e2';

-- ---------------------------------------------------------------------------
-- Şema ve yetkiler
-- ---------------------------------------------------------------------------
select has_column('public', 'notification_log', 'attempts', 'şema: notification_log.attempts');
select has_column('public', 'notification_log', 'claimed_at', 'şema: notification_log.claimed_at');
select has_column('public', 'notification_log', 'ref_id', 'şema: notification_log.ref_id');
select hasnt_table('public', 'telegram_link_attempts', 'şema: telegram_link_attempts kalktı');
select ok(not has_function_privilege('authenticated', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE'),
          'yetki: _notification_claim istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_finish(bigint, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._notification_finish(bigint, text, text)', 'EXECUTE'),
          'yetki: _notification_finish istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._notification_done(uuid, text, date, uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public._notification_since(text, uuid)', 'EXECUTE'),
          'yetki: yardımcı iç fonksiyonlar authenticated''a kapalı');
select ok(has_function_privilege('service_role', 'public._notification_claim(uuid, uuid, text, date, uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_finish(bigint, text, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: service_role iç fonksiyonları çağırır');
select ok(not has_function_privilege('authenticated', 'public._notification_targets(timestamptz)', 'EXECUTE'),
          'yetki: _notification_targets authenticated''a kapalı');
select ok(to_regprocedure('public._notification_claim(uuid, uuid, text, date)') is null
          and to_regprocedure('public._notification_done(uuid, text, date)') is null,
          'eski 4 ve 3 parametreli imzalar kaldırıldı (overload yok)');

-- D2: members INSERT kolon yetkisi
select ok(not has_column_privilege('authenticated', 'public.members', 'notify_callback', 'INSERT')
          and not has_column_privilege('authenticated', 'public.members', 'notify_appointment', 'INSERT')
          and not has_column_privilege('authenticated', 'public.members', 'notify_morning', 'INSERT'),
          'D2: authenticated bildirim kolonlarına insert yetkisi yok');
select ok(has_column_privilege('authenticated', 'public.members', 'full_name', 'INSERT')
          and has_column_privilege('authenticated', 'public.members', 'user_id', 'INSERT'),
          'D2: yönetimsel kolonlara insert yetkisi sürüyor');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.members (tenant_id, user_id, full_name, role, notify_callback)
                   values ('10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Yeni Kişi', 'agent', false)$$,
                 '42501', null, 'D2: yönetici insert ile bildirim tercihi yazamaz');
select lives_ok($$insert into public.members (tenant_id, user_id, full_name, role)
                  values ('10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Yeni Kişi', 'agent')$$,
                'D2: yönetici tercih olmadan üye ekleyebilir');
select throws_ok($$update public.members set notify_callback = false where user_id = '20000000-0000-4000-8000-0000000000e4'$$,
                 '42501', null, 'D2: yönetici update ile de tercih yazamaz');
reset role;
delete from public.members where user_id = '20000000-0000-4000-8000-0000000000e4';

-- ---------------------------------------------------------------------------
-- O1 (push): geri arama penceresi [next_call_at, next_call_at + 45 dk)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets(now() - interval '31 minutes')
           where ref_id = '40000000-0000-4000-8000-0000000000e2'),
          0, 'O1: geri arama saatinden önce hedef yok');
select is((select count(*)::int from _cb), 1, 'O1: saati gelen geri arama hedef');
select is((select count(*)::int from public._notification_targets(now() + interval '14 minutes')
           where ref_id = '40000000-0000-4000-8000-0000000000e2'),
          1, 'O1: 44. dakikada hâlâ hedef');
select is((select count(*)::int from public._notification_targets(now() + interval '16 minutes')
           where ref_id = '40000000-0000-4000-8000-0000000000e2'),
          0, 'O1: 45 dakikadan sonra hedef yok');
select is((select payload from _cb),
          jsonb_build_object('first_name', 'Bora', 'last_initial', 'İ',
                             'at', to_char((now() - interval '30 minutes') at time zone 'Europe/Istanbul', 'HH24:MI')),
          'O1: payload yalnız ad, soyadın baş harfi ve saat');
select ok((select not (payload ? 'phone') and payload::text not like '%0532%' from _cb), 'O1: payload telefon içermez');
update public.tenant_settings set push_enabled = false where tenant_id = '10000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from _cb), 0, 'O1: push kapalı kiracıya hedef yok');
update public.tenant_settings set push_enabled = true where tenant_id = '10000000-0000-4000-8000-0000000000e1';

-- ---------------------------------------------------------------------------
-- D3: sahiplen, gönder, bitir
-- ---------------------------------------------------------------------------
insert into _t values ('c1', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'));
select ok((select v from _t where n = 'c1') is not null, 'D3: ilk sahiplenme id döner');
select is((select status || '/' || attempts || '/' || ref_id from public.notification_log where id = (select v from _t where n = 'c1')),
          'sending/1/40000000-0000-4000-8000-0000000000e2', 'D3: satır sending, attempts 1, ref_id yazıldı');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'),
          null::bigint, 'D3: ikinci sahiplenme null (çift gönderim yok)');
select is((select count(*)::int from _cb), 0, 'D3: taze sending kaydı hedef dışı');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'),
          null::bigint, 'D3: başka kiracı adına sahiplenilemez');

-- Yarım kalmış sending (10 dakikadan eski) yeniden sahiplenilir
update public.notification_log set claimed_at = now() - interval '11 minutes' where id = (select v from _t where n = 'c1');
select is((select count(*)::int from _cb), 1, 'D3: 10 dakikadan eski sending yeniden hedef');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'),
          (select v from _t where n = 'c1'), 'D3: eski sending aynı satırla yeniden sahiplenilir');
select is((select attempts from public.notification_log where id = (select v from _t where n = 'c1')), 2, 'D3: attempts 2');

-- Başarısız: hedef geri döner, üçüncü denemeden sonra durur
select lives_ok($$select public._notification_finish((select v from _t where n = 'c1'), 'failed', 'Push hatası 502')$$, 'D3: finish failed');
select is((select status || '/' || coalesce(error, '-') from public.notification_log where id = (select v from _t where n = 'c1')),
          'failed/Push hatası 502', 'D3: hata ve durum yazıldı');
select is((select count(*)::int from _cb), 1, 'D3: failed (attempts < 3) yeniden hedef');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'),
          (select v from _t where n = 'c1'), 'D3: failed yeniden sahiplenilir');
select is((select status || '/' || attempts || '/' || coalesce(error, '-') from public.notification_log where id = (select v from _t where n = 'c1')),
          'sending/3/-', 'D3: attempts 3, hata temizlendi');
select public._notification_finish((select v from _t where n = 'c1'), 'failed', 'yine hata');
select is((select count(*)::int from _cb), 0, 'D3: 3 deneme sonrası hedef dışı');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'),
          null::bigint, 'D3: 3 deneme sonrası sahiplenilemez');

-- Müşteri aynı gün yeniden "sonra ara" ile planlanırsa yeni plan için bildirim tekrar gider
update public.notification_log set claimed_at = now() - interval '20 minutes' where id = (select v from _t where n = 'c1');
update public.customers set next_call_at = now() - interval '5 minutes' where id = '40000000-0000-4000-8000-0000000000e2';
select is((select count(*)::int from _cb), 1, 'D3: yeniden planlanan geri arama tekrar hedef');
insert into _t values ('c3', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e2'));
select is(((select v from _t where n = 'c3') = (select v from _t where n = 'c1'))::text
          || '/' || (select status || '/' || attempts from public.notification_log where id = (select v from _t where n = 'c1')),
          'true/sending/1', 'D3: yeni plan aynı satırı sıfırlayıp sahiplenir');

-- Başarı: hedef dışı, finish yalnız sending satırı değiştirir
insert into _t values ('c2', public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e1'));
select public._notification_finish((select v from _t where n = 'c2'), 'sent', null);
select is((select count(*)::int from public._notification_targets(now()) where ref_id = '40000000-0000-4000-8000-0000000000e1'),
          0, 'D3: sent kaydı hedef dışı');
select public._notification_finish((select v from _t where n = 'c2'), 'failed', 'geç gelen');
select is((select status from public.notification_log where id = (select v from _t where n = 'c2')),
          'sent', 'D3: bitmiş satır ikinci finish ile değişmez');
select is(public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e1'),
          null::bigint, 'D3: sent sonrası sahiplenilemez');
select throws_ok($$select public._notification_finish((select v from _t where n = 'c2'), 'sending', null)$$,
                 '22023', null, 'D3: finish geçersiz durumu reddeder');
select throws_ok($$select public._notification_claim(null, '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today(), '40000000-0000-4000-8000-0000000000e1')$$,
                 '22023', null, 'D3: eksik parametre 22023');
select throws_ok($$select public._notification_claim('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'callback', public.tr_today())$$,
                 '22023', null, 'D3: geri arama müşteri kimliği olmadan sahiplenilemez');

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

select * from finish();
rollback;
