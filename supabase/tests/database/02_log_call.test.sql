begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ---------------------------------------------------------------------------
-- Fixture (postgres olarak)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'lc-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'lc-a1@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1');

insert into public.members (id, tenant_id, user_id, full_name, role) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent');

insert into public.customers (id, tenant_id, full_name, phone, assigned_to)
select ('40000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '10000000-0000-4000-8000-000000000001', 'Kurgu Müşteri ' || i, '0532111' || lpad(i::text, 4, '0'),
       case when i = 8 then '30000000-0000-4000-8000-000000000002'::uuid end
from generate_series(1, 9) i;

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
values ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000008',
        '30000000-0000-4000-8000-000000000002', 1);

-- ---------------------------------------------------------------------------
-- Yönetici olarak
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- no_answer x3 -> pool
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer')),
          'retry', '1. açmadı: retry');
select is((select attempts_in_round from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          1, '1. açmadı: deneme 1');
select is((select next_call_at from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          now(), '1. açmadı: aynı gün tekrar (next_call_at = now)');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000001', 'busy')),
          'retry', '2. meşgul: retry');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer', 'üçüncü')),
          'pool', '3. başarısız: havuza düşer');
select is((select pool_count from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          1, 'pool_count 1 oldu');
select is((select attempts_in_round from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          0, 'havuzda deneme sayacı sıfırlandı');
select is((select next_call_at from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          public.tr_day_start(public.tr_today() + 7), 'havuz dönüşü 7 gün sonra yerel 00:00');
select is((select last_note from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          'üçüncü', 'last_note güncellendi');

-- ikinci tur (0700 sonrası log_call havuzdaki müşteriye kapalı: dağıtımın yaptığı
-- havuz dönüşü burada postgres olarak taklit edilir)
reset role;
update public.customers set call_status = 'retry' where id = '40000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  perform public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer');
  perform public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer');
  perform public.log_call('40000000-0000-4000-8000-000000000001', 'busy');
end $$;
select is((select pool_count from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          2, 'ikinci turdan sonra pool_count 2');
select is((select call_status from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          'pool', 'ikinci turdan sonra yine havuz');

-- üçüncü tur: max_rounds (2) aşıldı -> unreachable
reset role;
update public.customers set call_status = 'retry' where id = '40000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  perform public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer');
  perform public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer');
end $$;
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000001', 'no_answer')),
          'unreachable', 'max_rounds sonrası ulaşılamadı');
select is((select pool_count from public.customers where id = '40000000-0000-4000-8000-000000000001'),
          2, 'unreachable olunca pool_count artmaz');
select is((select count(*)::int from public.call_attempts where customer_id = '40000000-0000-4000-8000-000000000001'),
          9, 'her çağrı call_attempts satırı ekler');

-- callback
select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-000000000002', 'callback', null, now() - interval '1 hour')$$,
  '22023', 'Geri arama zamanı gelecekte bir tarih ve saat olmalı.', 'geçmiş geri arama reddedilir');
select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-000000000002', 'callback')$$,
  '22023', 'Geri arama zamanı gelecekte bir tarih ve saat olmalı.', 'geri arama zamanı zorunlu');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000002', 'callback', 'akşam ara',
                                                    now() + interval '2 days')),
          'retry', 'geri arama: retry');
select is((select next_call_at from public.customers where id = '40000000-0000-4000-8000-000000000002'),
          now() + interval '2 days', 'geri arama: next_call_at = verilen zaman');
select is((select attempts_in_round from public.customers where id = '40000000-0000-4000-8000-000000000002'),
          0, 'geri arama deneme sayılmaz');

-- appointment
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000003', 'appointment', 'cumartesi gelecek')),
          'done', 'randevu: done');
select is((select pipeline_stage from public.customers where id = '40000000-0000-4000-8000-000000000003'),
          'appointment', 'randevu: pipeline_stage appointment');
select is((select count(*)::int from public.pipeline_events
           where customer_id = '40000000-0000-4000-8000-000000000003' and stage = 'appointment'),
          1, 'randevu: pipeline_events satırı');

-- not_interested, disqualified, wrong_number
select is((select call_status || '/' || pipeline_stage from public.log_call('40000000-0000-4000-8000-000000000004', 'not_interested')),
          'done/not_interested', 'ilgilenmiyor: done + not_interested');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000005', 'disqualified', 'icra var')),
          'disqualified', 'uygun değil: disqualified');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000006', 'wrong_number')),
          'disqualified', 'yanlış numara: disqualified');
select is((select last_outcome from public.customers where id = '40000000-0000-4000-8000-000000000006'),
          'wrong_number', 'last_outcome güncellendi');

select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-000000000007', 'hello')$$,
  '22023', 'Geçersiz arama sonucu. Listeden bir sonuç seçin.', 'geçersiz sonuç reddedilir');

select ok((select count(*) from public.audit_log where action = 'log_call') >= 13, 'log_call audit_log yazar');

-- set_pipeline_stage
select is((select call_status || '/' || pipeline_stage
           from public.set_pipeline_stage('40000000-0000-4000-8000-000000000003', 'completed', 'satış tamam')),
          'done/completed', 'set_pipeline_stage completed -> done');

reset role;

-- ---------------------------------------------------------------------------
-- Ajan olarak
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.log_call('40000000-0000-4000-8000-000000000007', 'no_answer')$$,
  '42501', 'Müşteri bulunamadı veya bu müşteri için işlem yetkiniz yok.', 'ajan atanmamış müşteriye kayıt giremez');
select is((select call_status from public.log_call('40000000-0000-4000-8000-000000000008', 'busy')),
          'retry', 'ajan bugün kendine atanan müşteriye kayıt girer');
select is((select member_id from public.call_attempts where customer_id = '40000000-0000-4000-8000-000000000008'),
          '30000000-0000-4000-8000-000000000002'::uuid, 'deneme çağıran üyeye yazılır');

reset role;
select * from finish();
rollback;
