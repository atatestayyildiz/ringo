-- Panel kilidi (migration 20261005001200_panel_lock.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'lk-yonetici@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'lk-ajan@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'lk-uyesiz@test.test');
insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000e1', 'Kilit Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Yasemin Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Arda Ajan', 'agent', '{}');
insert into public.customers (id, tenant_id, full_name, phone, assigned_to) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Müşteri', '05325550801', '30000000-0000-4000-8000-0000000000e2');
insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 1);
insert into public.call_attempts (tenant_id, customer_id, member_id, outcome) values
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'no_answer');
insert into public.pipeline_events (tenant_id, customer_id, member_id, stage) values
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'appointment');

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.set_my_pin(text,text)', 'EXECUTE'), 'anon set_my_pin çağıramaz');
select ok(not has_function_privilege('anon', 'public.lock_me()', 'EXECUTE'), 'anon lock_me çağıramaz');
select ok(not has_function_privilege('anon', 'public.unlock_with_pin(text)', 'EXECUTE'), 'anon unlock_with_pin çağıramaz');
select ok(not has_function_privilege('anon', 'public.lock_status()', 'EXECUTE'), 'anon lock_status çağıramaz');
select ok(not has_function_privilege('anon', 'public.set_my_auto_lock(integer)', 'EXECUTE'), 'anon set_my_auto_lock çağıramaz');
select ok(to_regprocedure('public.clear_my_lock()') is null, 'clear_my_lock kaldırıldı (şifreli giriş kilidi açmaz)');
select ok(not has_function_privilege('anon', 'public.auth_unlocked()', 'EXECUTE'), 'anon auth_unlocked çağıramaz');
select ok(has_function_privilege('authenticated', 'public.set_my_pin(text,text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.lock_me()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.unlock_with_pin(text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.lock_status()', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_my_auto_lock(integer)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.reset_member_pin(uuid)', 'EXECUTE'),
          'authenticated kilit RPC''lerini çağırır');
select ok(not has_function_privilege('authenticated', 'public._assert_unlocked()', 'EXECUTE'), '_assert_unlocked authenticated''a kapalı');
select ok(not has_function_privilege('authenticated', 'public._pin_is_weak(text)', 'EXECUTE'), '_pin_is_weak authenticated''a kapalı');
select ok(not has_function_privilege('public', 'public._assert_unlocked()', 'EXECUTE'), '_assert_unlocked public''e kapalı');
select ok(not has_column_privilege('authenticated', 'public.members', 'pin_hash', 'SELECT')
          and not has_column_privilege('authenticated', 'public.members', 'pin_failed', 'SELECT')
          and not has_column_privilege('authenticated', 'public.members', 'auto_lock_minutes', 'SELECT')
          and not has_column_privilege('authenticated', 'public.members', 'locked_at', 'SELECT'),
          'kilit kolonları okunamaz');
select ok(not has_column_privilege('authenticated', 'public.members', 'pin_hash', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.members', 'pin_failed', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.members', 'auto_lock_minutes', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.members', 'locked_at', 'UPDATE'),
          'kilit kolonları doğrudan güncellenemez');
select ok(not has_column_privilege('authenticated', 'public.members', 'locked_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.members', 'pin_hash', 'INSERT'),
          'kilit kolonları insert ile yazılamaz');

-- ---------------------------------------------------------------------------
-- Ajan: PIN kuralları
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;

select is(public.lock_status(), '{"locked": false, "has_pin": false, "pin_length": 6, "auto_lock_minutes": 10, "auto_lock_minutes_mobile": 0}'::jsonb, 'ilk durum: PIN yok, açık, bilgisayarda 10 dk, telefonda kapalı');
select throws_ok($$select public.lock_me()$$, '22023', null, 'PIN yokken kilitlenemez');
select throws_ok($$select public.set_my_pin('111111')$$, '22023', null, '111111 zayıf');
select throws_ok($$select public.set_my_pin('000000')$$, '22023', null, '000000 (demo PIN) zayıf, RPC kabul etmez');
select throws_ok($$select public.set_my_pin('123456')$$, '22023', null, '123456 zayıf');
select throws_ok($$select public.set_my_pin('654321')$$, '22023', null, '654321 zayıf');
select throws_ok($$select public.set_my_pin('890123')$$, '22023', null, '890123 zayıf (döngü)');
select throws_ok($$select public.set_my_pin('121212')$$, '22023', null, '121212 zayıf');
select throws_ok($$select public.set_my_pin('123123')$$, '22023', null, '123123 zayıf');
select throws_ok($$select public.set_my_pin('123')$$, '22023', null, '3 hane reddedilir');
select throws_ok($$select public.set_my_pin('135790246')$$, '22023', null, '9 hane reddedilir');
select throws_ok($$select public.set_my_pin('1111')$$, '22023', null, '1111 zayıf');
select throws_ok($$select public.set_my_pin('1212')$$, '22023', null, '1212 zayıf');
select throws_ok($$select public.set_my_pin('4321')$$, '22023', null, '4321 zayıf');
select throws_ok($$select public.set_my_pin('12a456')$$, '22023', null, 'harf reddedilir');
select throws_ok($$select public.set_my_pin(null)$$, '22023', null, 'boş PIN reddedilir');
select lives_ok($$select public.set_my_pin('246810')$$, 'ilk PIN mevcut PIN olmadan belirlenir');
select is((public.lock_status() ->> 'has_pin')::boolean, true, 'has_pin true');
select is((public.lock_status() ->> 'pin_length')::int, 6, 'pin_length 6');
select throws_ok($$select pin_hash from public.members where id = '30000000-0000-4000-8000-0000000000e2'$$, '42501', null, 'pin_hash istemciden okunamaz');
select throws_ok($$update public.members set locked_at = null where id = '30000000-0000-4000-8000-0000000000e2'$$, '42501', null, 'locked_at doğrudan yazılamaz');

reset role;
select ok((select pin_hash from public.members where id = '30000000-0000-4000-8000-0000000000e2') like '$2%', 'pin_hash bcrypt');
select ok((select pin_hash from public.members where id = '30000000-0000-4000-8000-0000000000e2') not like '%246810%', 'düz PIN saklanmaz');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.set_my_pin('135790')$$, '22023', 'Mevcut PIN hatalı.', 'PIN varken mevcut PIN gerekir');
select throws_ok($$select public.set_my_pin('135790', '999999')$$, '22023', 'Mevcut PIN hatalı.', 'yanlış mevcut PIN reddedilir');
select lives_ok($$select public.set_my_pin('135790', '246810')$$, 'doğru mevcut PIN ile değişir');
select lives_ok($$select public.set_my_auto_lock(5)$$, 'otomatik kilit 5 dk');
select throws_ok($$select public.set_my_auto_lock(7)$$, '22023', null, 'izin verilmeyen süre reddedilir');
select is((public.lock_status() ->> 'auto_lock_minutes')::int, 5, 'süre kaydedildi');
select lives_ok($$select public.set_my_auto_lock_mobile(15)$$, 'telefon otomatik kilit 15 dk');
select throws_ok($$select public.set_my_auto_lock_mobile(7)$$, '22023', null, 'telefon için izin verilmeyen süre reddedilir');
select is((public.lock_status() ->> 'auto_lock_minutes_mobile')::int, 15, 'telefon süresi kaydedildi, bilgisayar süresi ayrı kalır');

-- ---------------------------------------------------------------------------
-- Kilitliyken veri ve iş RPC reddi
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.customers), 1, 'açıkken müşteri görünür');
select lives_ok($$select public.lock_me()$$, 'ajan kilitlenir');
select is((public.lock_status() ->> 'locked')::boolean, true, 'locked true');
select is((select count(*)::int from public.customers), 0, 'kilitliyken customers 0 satır');
select is((select count(*)::int from public.daily_assignments), 0, 'kilitliyken daily_assignments 0 satır');
select is((select count(*)::int from public.call_attempts), 0, 'kilitliyken call_attempts 0 satır');
select is((select count(*)::int from public.pipeline_events), 0, 'kilitliyken pipeline_events 0 satır');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000e1', 'no_answer')$$, '42501', 'Panel kilitli.', 'kilitliyken log_call reddedilir');
select throws_ok($$select * from public.list_pool()$$, '42501', 'Panel kilitli.', 'kilitliyken list_pool reddedilir');
select throws_ok($$select public.set_my_pin('975310', '135790')$$, '42501', null, 'kilitliyken PIN değiştirilemez');
select throws_ok($$select public.set_my_auto_lock(10)$$, '42501', null, 'kilitliyken süre değiştirilemez');

-- Başkasının kilidine dokunamama: yönetici kendi RPC'leriyle ajanın kilidini açamaz.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
select is((select count(*)::int from public.customers), 1, 'yönetici (açık) müşteriyi görür');
select is(public.unlock_with_pin('135790') ->> 'ok', 'true', 'yöneticinin unlock''u yalnız kendi (açık) satırına bakar');
select is((public.lock_status() ->> 'locked')::boolean, false, 'yönetici açık kalır');
select throws_ok($$update public.members set locked_at = null where id = '30000000-0000-4000-8000-0000000000e2'$$, '42501', null, 'yönetici ajanın locked_at''ini yazamaz');
reset role;
select ok((select locked_at is not null from public.members where id = '30000000-0000-4000-8000-0000000000e2'), 'ajan hâlâ kilitli');

-- ---------------------------------------------------------------------------
-- Açma: yanlış sayacı, doğru PIN, 5 yanlışta signed_out
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select is(public.unlock_with_pin('000001'), '{"ok": false, "remaining": 4, "signed_out": false}'::jsonb, '1. yanlış: 4 hak');
select is(public.unlock_with_pin('abc'), '{"ok": false, "remaining": 3, "signed_out": false}'::jsonb, 'biçimsiz giriş de yanlış sayılır');
select is(public.unlock_with_pin('135790'), '{"ok": true, "remaining": 5, "signed_out": false}'::jsonb, 'doğru PIN açar');
select is((select count(*)::int from public.customers), 1, 'açılınca müşteri yeniden görünür');
reset role;
select is((select pin_failed::int from public.members where id = '30000000-0000-4000-8000-0000000000e2'), 0, 'doğru PIN sayacı sıfırlar');
set local role authenticated;

select public.lock_me();
select public.unlock_with_pin('000001'), public.unlock_with_pin('000002'), public.unlock_with_pin('000003'), public.unlock_with_pin('000004');
select is(public.unlock_with_pin('000005'), '{"ok": false, "remaining": 0, "signed_out": true}'::jsonb, '5. yanlış: signed_out');
select is(public.unlock_with_pin('135790') ->> 'signed_out', 'true', 'aynı oturumda doğru PIN de kabul edilmez');
select is((public.lock_status() ->> 'locked')::boolean, true, 'kilit kalır');

-- Y1: şifreli giriş kilidi kaldıramaz; yalnız yönetici PIN'i sıfırlayabilir.
select throws_ok($$select public.reset_member_pin('30000000-0000-4000-8000-0000000000e2')$$, '42501', 'Panel kilitli.', 'kilitli üye PIN sıfırlayamaz');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.reset_member_pin('30000000-0000-4000-8000-0000000000e1')$$, '22023', null, 'yönetici kendi PIN''ini sıfırlayamaz');
select lives_ok($$select public.reset_member_pin('30000000-0000-4000-8000-0000000000e2')$$, 'yönetici üyenin PIN''ini sıfırlar');
reset role;
select ok((select pin_hash is null and locked_at is null and pin_failed = 0 from public.members where id = '30000000-0000-4000-8000-0000000000e2'), 'PIN silindi, kilit ve sayaç temiz');
select ok(exists (select 1 from public.audit_log where action = 'pin_reset' and entity_id = '30000000-0000-4000-8000-0000000000e2'), 'PIN sıfırlama audit''e yazıldı');

-- Y2: kilitli yönetici yetki/ayar yazamaz, audit okuyamaz.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select public.set_my_pin('864219');
select public.lock_me();
select is(public.auth_is_manager(), false, 'kilitli yönetici auth_is_manager false');
select is_empty($$update public.members set role = 'manager' where id = '30000000-0000-4000-8000-0000000000e2' returning 1$$, 'kilitli yönetici rol yazamaz');
select is_empty($$update public.tenant_settings set brand_name = 'X' returning 1$$, 'kilitli yönetici ayar yazamaz');
select is((select count(*)::int from public.audit_log), 0, 'kilitli yönetici audit okuyamaz');
reset role;

-- Üyeliği olmayan kullanıcı
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select is(public.lock_status(), null::jsonb, 'üyesiz: lock_status null');
reset role;

select * from finish();
rollback;
