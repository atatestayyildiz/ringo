-- Randevu zamanı (migration 20261005000500_appointment_time.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------------
-- Fixture (postgres olarak). Kiracı A: yönetici, ajan1 (atanmış), ajan2 (yetkisiz). Kiracı B: yönetici.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'ap-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'ap-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'ap-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000b4', 'authenticated', 'authenticated', 'ap-mgrb@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000b1', 'Randevu Kiracı A'),
  ('10000000-0000-4000-8000-0000000000b2', 'Randevu Kiracı B');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1', 'Yönetici Randevu', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b2', 'Deniz Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b3', 'Ekin Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000b4', '10000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b4', 'Yönetici Diğer', 'manager', '{}');

-- c1-c4: açık arama kaydı (yönetici log_call). c5-c9: ajan1'e bugün atanmış.
insert into public.customers (id, tenant_id, full_name, phone) values
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 1', '05321190001'),
  ('40000000-0000-4000-8000-0000000000b2', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 2', '05321190002'),
  ('40000000-0000-4000-8000-0000000000b3', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 3', '05321190003'),
  ('40000000-0000-4000-8000-0000000000b4', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 4', '05321190004');

insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status, pipeline_stage, appointment_day) values
  ('40000000-0000-4000-8000-0000000000b5', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 5', '05321190005', '30000000-0000-4000-8000-0000000000b2', 'done', 'appointment', public.tr_today()),
  ('40000000-0000-4000-8000-0000000000b6', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 6', '05321190006', '30000000-0000-4000-8000-0000000000b2', 'done', 'appointment', public.tr_today()),
  ('40000000-0000-4000-8000-0000000000b7', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 7', '05321190007', '30000000-0000-4000-8000-0000000000b2', 'done', 'appointment', public.tr_today() + 1),
  ('40000000-0000-4000-8000-0000000000b8', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 8', '05321190008', '30000000-0000-4000-8000-0000000000b2', 'done', 'visited', public.tr_today()),
  ('40000000-0000-4000-8000-0000000000b9', '10000000-0000-4000-8000-0000000000b1', 'Kurgu Randevu 9', '05321190009', '30000000-0000-4000-8000-0000000000b2', 'pending', null, null);

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000b1', public.tr_today(),
       ('40000000-0000-4000-8000-0000000000b' || i)::uuid, '30000000-0000-4000-8000-0000000000b2', i
from generate_series(5, 9) i;

insert into public.push_subscriptions (tenant_id, member_id, endpoint, p256dh, auth) values
  ('10000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-0000000000b2', 'https://push.example.test/ap-1', repeat('a', 87), repeat('b', 22));
update public.tenant_settings
set push_enabled = true, distribution_mode = 'manual', distribution_hour = 8, summary_hour = 19
where tenant_id = '10000000-0000-4000-8000-0000000000b1';

-- ---------------------------------------------------------------------------
-- Şema, check constraint, yetkiler
-- ---------------------------------------------------------------------------
select has_column('public', 'customers', 'appointment_day', 'customers.appointment_day var');
select has_column('public', 'customers', 'appointment_time', 'customers.appointment_time var');
select throws_ok(
  $$insert into public.customers (tenant_id, full_name, phone, appointment_time)
    values ('10000000-0000-4000-8000-0000000000b1', 'Kurgu Saat', '05321190099', '10:00')$$,
  '23514', null, 'saat dolu gün boş satır check ile reddedilir');
select ok(not has_column_privilege('authenticated', 'public.customers', 'appointment_day', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.customers', 'appointment_time', 'UPDATE'),
          'authenticated randevu kolonlarını doğrudan güncelleyemez');
select ok(not has_column_privilege('anon', 'public.customers', 'appointment_day', 'UPDATE')
          and not has_column_privilege('anon', 'public.customers', 'appointment_time', 'UPDATE'),
          'anon randevu kolonlarını güncelleyemez');
select ok(has_column_privilege('authenticated', 'public.customers', 'full_name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.customers', 'birth_date', 'UPDATE'),
          'mevcut kolonlarda doğrudan update yetkisi korunur');
select ok(has_column_privilege('authenticated', 'public.customers', 'appointment_day', 'SELECT'),
          'authenticated randevu kolonlarını okuyabilir');
select ok(to_regprocedure('public.log_call(uuid, text, text, timestamptz)') is null,
          'eski 4 parametreli log_call imzası kaldırıldı (overload yok)');
select ok(not has_function_privilege('anon', 'public.log_call(uuid, text, text, timestamptz, date, time)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_appointment(uuid, date, time)', 'EXECUTE'),
          'anon log_call / set_appointment çalıştıramaz');
select ok(has_function_privilege('authenticated', 'public.log_call(uuid, text, text, timestamptz, date, time)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_appointment(uuid, date, time)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_pipeline_stage(uuid, text, text)', 'EXECUTE'),
          'authenticated log_call / set_appointment / set_pipeline_stage çalıştırır');
select ok(not has_function_privilege('public', 'public.set_appointment(uuid, date, time)', 'EXECUTE'),
          'public rolünde set_appointment yetkisi yok');
select is((select prosecdef from pg_proc where oid = 'public.set_appointment(uuid, date, time)'::regprocedure),
          true, 'set_appointment security definer');

-- ---------------------------------------------------------------------------
-- Push: saati belli olmayan randevu (c5, c6) için hatırlatma yok; sabah hedefi kalktı
-- ---------------------------------------------------------------------------
select is((select count(*)::int
           from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000b2' and kind = 'appointment'),
          0, 'saati belli olmayan randevu için appointment hedefi yok');
select is((select count(*)::int
           from public._notification_targets((public.tr_today()::timestamp + interval '9 hours') at time zone 'Europe/Istanbul')
           where member_id = '30000000-0000-4000-8000-0000000000b2' and kind = 'morning'),
          0, 'morning hedefi üretilmez');

-- ---------------------------------------------------------------------------
-- Yönetici: log_call
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is((select appointment_day::text || ' ' || appointment_time::text
           from public.log_call('40000000-0000-4000-8000-0000000000b1', 'appointment', 'öğleden sonra', null,
                                public.tr_today() + 2, '14:30')),
          (public.tr_today() + 2)::text || ' 14:30:00', 'log_call: gün + saat');
select is((select pipeline_stage || '/' || call_status from public.customers where id = '40000000-0000-4000-8000-0000000000b1'),
          'appointment/done', 'log_call randevu: aşama ve durum');
select is((select (appointment_day = public.tr_today() and appointment_time is null)
           from public.log_call('40000000-0000-4000-8000-0000000000b2', 'appointment', null, null, public.tr_today())),
          true, 'log_call: yalnız gün (bugün)');
select is((select (appointment_day is null and appointment_time is null)
           from public.log_call('40000000-0000-4000-8000-0000000000b3', 'appointment')),
          true, 'log_call: belli değil (ikisi null)');
select is((select data ->> 'appointment_time' from public.audit_log
           where action = 'log_call' and entity_id = '40000000-0000-4000-8000-0000000000b1'
           order by id desc limit 1),
          '14:30:00', 'log_call audit randevu zamanını içerir');

select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-0000000000b4', 'appointment', null, null, public.tr_today() - 1)$$,
  '22023', 'Randevu günü bugünden önce olamaz.', 'log_call: geçmiş gün reddedilir');
select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-0000000000b4', 'appointment', null, null, null, '10:00')$$,
  '22023', 'Randevu saati için önce gün seçin.', 'log_call: gün olmadan saat reddedilir');
select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-0000000000b4', 'callback', null, now() + interval '1 day', public.tr_today() + 1)$$,
  '22023', 'Randevu günü ve saati yalnız "Dükkana gelecek" sonucunda girilebilir.',
  'log_call: başka sonuçta randevu parametresi reddedilir');
select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-0000000000b4', 'no_answer', null, null, null, '09:00')$$,
  '22023', 'Randevu günü ve saati yalnız "Dükkana gelecek" sonucunda girilebilir.',
  'log_call: başka sonuçta yalnız saat de reddedilir');
select is((select call_status from public.log_call('40000000-0000-4000-8000-0000000000b4', 'no_answer', null, null)),
          'retry', 'eski 4 parametreli çağrı çalışır');
select is((select call_status from public.log_call('40000000-0000-4000-8000-0000000000b4', 'busy')),
          'retry', 'eski 2 parametreli çağrı çalışır');

-- Doğrudan kolon güncellemesi (yönetici, RLS izinli satır)
select throws_ok(
  $$update public.customers set appointment_day = public.tr_today() + 5 where id = '40000000-0000-4000-8000-0000000000b1'$$,
  '42501', null, 'yönetici appointment_day kolonunu doğrudan güncelleyemez');
select throws_ok(
  $$update public.customers set appointment_time = '11:00' where id = '40000000-0000-4000-8000-0000000000b1'$$,
  '42501', null, 'yönetici appointment_time kolonunu doğrudan güncelleyemez');
select lives_ok(
  $$update public.customers set full_name = 'Kurgu Randevu Bir' where id = '40000000-0000-4000-8000-0000000000b1'$$,
  'yönetici mevcut kolonları doğrudan güncellemeye devam eder');

reset role;

-- ---------------------------------------------------------------------------
-- Ajan1 (atanmış): set_appointment
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;

select is((select appointment_day::text || ' ' || appointment_time::text
           from public.set_appointment('40000000-0000-4000-8000-0000000000b5', public.tr_today() + 1, '16:00')),
          (public.tr_today() + 1)::text || ' 16:00:00', 'set_appointment: ajan kendi müşterisinde gün + saat');
select is((select (appointment_day = public.tr_today() + 3 and appointment_time is null)
           from public.set_appointment('40000000-0000-4000-8000-0000000000b5', public.tr_today() + 3, null)),
          true, 'set_appointment: yalnız gün');
select is((select (appointment_day is null and appointment_time is null)
           from public.set_appointment('40000000-0000-4000-8000-0000000000b5', null, null)),
          true, 'set_appointment: temizle (belli değil)');
select is((select (appointment_day is null and appointment_time is null)
           from public.set_appointment('40000000-0000-4000-8000-0000000000b6')),
          true, 'set_appointment: parametresiz çağrı belli değil yapar');
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b5', public.tr_today() - 1, null)$$,
  '22023', 'Randevu günü bugünden önce olamaz.', 'set_appointment: geçmiş gün reddedilir');
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b5', null, '10:00')$$,
  '22023', 'Randevu saati için önce gün seçin.', 'set_appointment: gün olmadan saat reddedilir');
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b9', public.tr_today(), null)$$,
  '22023', 'Randevu zamanı yalnız "Dükkana gelecek" aşamasındaki müşteride değiştirilebilir.',
  'set_appointment: randevu aşamasında olmayan müşteri reddedilir');
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b8', public.tr_today(), null)$$,
  '22023', 'Randevu zamanı yalnız "Dükkana gelecek" aşamasındaki müşteride değiştirilebilir.',
  'set_appointment: randevu aşamasından çıkmış müşteri reddedilir');

reset role;
select is((select count(*)::int from public.audit_log
           where action = 'set_appointment' and entity_id = '40000000-0000-4000-8000-0000000000b5'),
          3, 'set_appointment audit_log yazar');

-- ---------------------------------------------------------------------------
-- Ajan2 (yetkisiz) ve başka kiracının yöneticisi
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b5', public.tr_today() + 1, null)$$,
  '42501', 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.',
  'set_appointment: yetkisiz çalışan başkasının müşterisini değiştiremez');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_appointment('40000000-0000-4000-8000-0000000000b5', public.tr_today() + 1, null)$$,
  '42501', 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.',
  'set_appointment: başka kiracının yöneticisi değiştiremez');
reset role;

select is((select appointment_day from public.customers where id = '40000000-0000-4000-8000-0000000000b5'),
          null::date, 'reddedilen çağrılar müşteriyi değiştirmedi');

-- ---------------------------------------------------------------------------
-- set_pipeline_stage: randevudan çıkınca kolonlar kalır; başka aşamadan randevuya girince null
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is((select appointment_day from public.set_pipeline_stage('40000000-0000-4000-8000-0000000000b7', 'visited')),
          public.tr_today() + 1, 'randevudan çıkınca randevu günü korunur');
select is((select (appointment_day is null and appointment_time is null)
           from public.set_pipeline_stage('40000000-0000-4000-8000-0000000000b7', 'appointment')),
          true, 'menüyle randevuya taşınınca belli değil (null)');
select is((select appointment_day from public.set_pipeline_stage('40000000-0000-4000-8000-0000000000b1', 'appointment')),
          public.tr_today() + 2, 'zaten randevuda olan müşteride aşama tekrarı zamanı silmez');

reset role;

select * from finish();
rollback;
