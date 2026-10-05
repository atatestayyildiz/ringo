-- Faz 2 inceleme düzeltmeleri 2. tur (migration 20261004001000_faz2_review_fixes2.sql)
-- D9 (izinli üye bildirim hedefi değil), Ş2 (telegram_chat_id tekil), D1 (telegram_chat_id istemciye kapalı)
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------------------------------------------------------------------------
-- Fixture (kurgusal)
-- Kiracı f1: Yönetici (f1), Sena ajan (f2, tekrar aranacak müşteri), Kaan ajan (f3, yeni müşteri)
-- Kiracı f2: başka kiracının yöneticisi (f4)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'rf2-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'rf2-sen@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated', 'rf2-kaa@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f4', 'authenticated', 'authenticated', 'rf2-oth@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'İkinci Tur Kiracı'),
  ('10000000-0000-4000-8000-0000000000f2', 'Diğer Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Sena Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f3', 'Kaan Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f4', 'Öteki Yönetici', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone, call_status, next_call_at, assigned_to) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Ece Bir', '05321260001', 'retry', now(), '30000000-0000-4000-8000-0000000000f2'),
  ('40000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', 'Ozan İki', '05321260002', 'pending', now(), '30000000-0000-4000-8000-0000000000f3');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000f1', public.tr_today(), '40000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f2', 1),
  ('10000000-0000-4000-8000-0000000000f1', public.tr_today(), '40000000-0000-4000-8000-0000000000f2', '30000000-0000-4000-8000-0000000000f3', 1);

update public.members set telegram_chat_id = 6001, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000f1';
update public.members set telegram_chat_id = 6002, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000f2';
update public.members set telegram_chat_id = 6003, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000f3';
update public.tenant_settings
set telegram_enabled = true, distribution_mode = 'manual', distribution_hour = 8, reminder_hour = 15, summary_hour = 19
where tenant_id = '10000000-0000-4000-8000-0000000000f1';

-- ---------------------------------------------------------------------------
-- D9: izinli üye sabah ve hatırlatma hedefi değildir
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f2' and kind in ('morning', 'reminder')),
          1, 'D9: izinsiz ajan morning hedefi (reminder kaldırıldı)');

update public.members set absent_on = public.tr_today() where id = '30000000-0000-4000-8000-0000000000f2';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f2' and kind = 'morning'),
          0, 'D9: bugün izinli ajana morning gitmez');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f2' and kind = 'reminder'),
          0, 'D9: bugün izinli ajana reminder gitmez');
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '10 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f3' and kind = 'morning'),
          1, 'D9: izinli olmayan iş arkadaşı etkilenmez');

update public.members set absent_on = public.tr_today() - 1 where id = '30000000-0000-4000-8000-0000000000f2';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f2' and kind in ('morning', 'reminder')),
          1, 'D9: dünkü izin bugünkü bildirimi engellemez');

update public.members set absent_on = public.tr_today() + 1 where id = '30000000-0000-4000-8000-0000000000f2';
select is((select count(*)::int from public._notification_targets((public.tr_today()::timestamp + interval '17 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000f2' and kind in ('morning', 'reminder')),
          1, 'D9: yarınki izin bugünkü bildirimi engellemez');
update public.members set absent_on = null where id = '30000000-0000-4000-8000-0000000000f2';

-- ---------------------------------------------------------------------------
-- Ş2: bir sohbet en fazla bir üyeye bağlı
-- ---------------------------------------------------------------------------
select ok((select i.indisunique from pg_index i where i.indexrelid = 'public.members_telegram_chat_id_key'::regclass)
          and (select pg_get_expr(i.indpred, i.indrelid) from pg_index i where i.indexrelid = 'public.members_telegram_chat_id_key'::regclass)
              = '(telegram_chat_id IS NOT NULL)',
          'Ş2: telegram_chat_id üzerinde kısmi unique indeks');
select throws_ok($$update public.members set telegram_chat_id = 6002 where id = '30000000-0000-4000-8000-0000000000f3'$$,
                 '23505', null, 'Ş2: iki üye aynı sohbete bağlanamaz');
select lives_ok($$update public.members set telegram_chat_id = null, telegram_linked_at = null
                  where id in ('30000000-0000-4000-8000-0000000000f4')$$,
                'Ş2: birden çok bağlantısız (null) üye olabilir');

-- Normal yol: aynı sohbet başka üyeye bağlanınca eskisi kalkar
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('MVCHT222', '10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f3', now() + interval '10 minutes');
select is((select public._telegram_consume_link_code('MVCHT222', 6002) ->> 'ok'),
          'true', 'Ş2: sohbet başka üyeye devredilir');
select is((select count(*)::int from public.members where telegram_chat_id = 6002), 1, 'Ş2: devirden sonra sohbette tek üye');
select is((select telegram_chat_id::text || '/' || coalesce(telegram_linked_at::text, '-') from public.members where id = '30000000-0000-4000-8000-0000000000f2'),
          null, 'Ş2: önceki üyenin bağlantısı ve zamanı temizlendi');

-- Yarış benzetimi: eski bağlantı temizlenirken başka bir işlem aynı sohbeti üçüncü üyeye bağlar.
-- Unique ihlali hata fırlatmaz, 'invalid' döner; kod kullanılmamış kalır, hiçbir bağlantı değişmez.
create function pg_temp.race_link() returns trigger language plpgsql as $f$
begin
  if old.telegram_chat_id = 7777 and new.telegram_chat_id is null and pg_trigger_depth() = 1 then
    update public.members set telegram_chat_id = 7777 where id = '30000000-0000-4000-8000-0000000000f1';
  end if;
  return null;
end;
$f$;
update public.members set telegram_chat_id = 7777 where id = '30000000-0000-4000-8000-0000000000f3';
create trigger race_link after update on public.members for each row execute function pg_temp.race_link();
insert into public.telegram_link_codes (code, tenant_id, member_id, expires_at) values
  ('RACEF222', '10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f2', now() + interval '10 minutes');
select is(public._telegram_consume_link_code('RACEF222', 7777),
          '{"ok": false, "reason": "invalid"}'::jsonb, 'Ş2: yarışta unique ihlali temiz invalid döner');
drop trigger race_link on public.members;
select ok((select used_at is null from public.telegram_link_codes where code = 'RACEF222'), 'Ş2: yarışta kod kullanılmış sayılmaz');
select is((select string_agg(id::text || '=' || coalesce(telegram_chat_id::text, '-'), ',' order by id) from public.members
           where tenant_id = '10000000-0000-4000-8000-0000000000f1'),
          '30000000-0000-4000-8000-0000000000f1=6001,30000000-0000-4000-8000-0000000000f2=-,30000000-0000-4000-8000-0000000000f3=7777',
          'Ş2: yarışta bağlantılar değişmez');
select is((select public._telegram_consume_link_code('RACEF222', 7777) ->> 'ok'),
          'true', 'Ş2: yarış yoksa aynı kod sonra tüketilebilir');
update public.members set telegram_chat_id = 6003, telegram_linked_at = now() where id = '30000000-0000-4000-8000-0000000000f3';
update public.members set telegram_chat_id = 6002 where id = '30000000-0000-4000-8000-0000000000f2';

-- ---------------------------------------------------------------------------
-- D1: telegram_chat_id istemciye kapalı, diğer kolonlar açık
-- ---------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.members', 'telegram_chat_id', 'SELECT')
          and not has_table_privilege('authenticated', 'public.members', 'SELECT')
          and not has_column_privilege('anon', 'public.members', 'telegram_chat_id', 'SELECT'),
          'D1: authenticated ve anon telegram_chat_id okuyamaz');
select ok(has_column_privilege('authenticated', 'public.members', 'id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'tenant_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'user_id', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'full_name', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'role', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'permissions', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'is_active', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'absent_on', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'created_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'telegram_linked_at', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_morning', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_reminder', 'SELECT')
          and has_column_privilege('authenticated', 'public.members', 'notify_summary', 'SELECT'),
          'D1: diğer tüm kolonlar authenticated için okunur');
select ok(has_column_privilege('service_role', 'public.members', 'telegram_chat_id', 'SELECT'),
          'D1: service_role telegram_chat_id okur');

-- Ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select telegram_chat_id from public.members$$, '42501', null, 'D1: ajan telegram_chat_id okuyamaz');
select throws_ok($$select * from public.members$$, '42501', null, 'D1: ajan select * yapamaz');
select throws_ok($$select count(*) from public.members where telegram_chat_id is not null$$,
                 '42501', null, 'D1: ajan filtrede de telegram_chat_id kullanamaz');
select is((select count(*)::int from public.members where telegram_linked_at is not null), 3,
          'D1: ajan bağlı olma bilgisini telegram_linked_at ile okur (yalnız kendi kiracısı)');
select is((select string_agg(full_name || ':' || notify_morning, ',' order by full_name) from public.members),
          'Kaan Ajan:true,Kurgu Yönetici:true,Sena Ajan:true', 'D1: ajan ad ve tercih kolonlarını okur');
select lives_ok($$select public.telegram_create_link_code()$$, 'D1: kod üretme RPC''si çalışır');
select lives_ok($$select public.set_notify_prefs(true, true, false)$$, 'D1: tercih RPC''si çalışır');
reset role;

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select id, telegram_chat_id from public.members$$, '42501', null, 'D1: yönetici telegram_chat_id okuyamaz');
select is((select count(*)::int from public.members where is_active and telegram_linked_at is not null), 3,
          'D1: yönetici ekibin bağlı olma durumunu görür');
select is((select count(*)::int from (select id, user_id, role, permissions, absent_on, created_at from public.members) x), 3,
          'D1: yönetici yönetimsel kolonları okur');
select lives_ok($$select public.telegram_unlink('30000000-0000-4000-8000-0000000000f3')$$, 'D1: yönetici bağlantı kaldırma RPC''si çalışır');
reset role;

select * from finish();
rollback;
