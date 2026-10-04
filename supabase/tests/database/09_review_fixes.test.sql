-- docs/review-faz1.md düzeltmelerinin kilitleri (migration 20261004000700_review_fixes.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'rf-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'rf-a@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'rf-d@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c4', 'authenticated', 'authenticated', 'rf-i@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', 'rf-v@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c6', 'authenticated', 'authenticated', 'rf-b@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', 'rf-mgr2@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000c1', 'Düzeltme Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Kurgu Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c2', 'Zeynep Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c3', 'Deniz Ajan', 'agent', '{"delete_customers": true}'),
  ('30000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c4', 'İpek Ajan', 'agent', '{"import_customers": true}'),
  ('30000000-0000-4000-8000-0000000000c5', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c5', 'Vural Ajan', 'agent', '{"view_all_customers": true, "delete_customers": true}'),
  ('30000000-0000-4000-8000-0000000000c6', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c6', 'Burak Ajan', 'agent', '{}');

insert into public.customers (id, tenant_id, full_name, phone, call_status, pipeline_stage, pool_count, attempts_in_round, next_call_at, assigned_to, applied_at) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Açık', '05321230001', 'pending', null, 0, 0, now(), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Havuz', '05321230002', 'pool', null, 1, 0,
   public.tr_day_start(public.tr_today() + 5), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Randevu', '05321230003', 'done', 'appointment', 0, 0, now(), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-0000000000c4', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Ulaşılamaz', '05321230004', 'unreachable', null, 2, 0, now(), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-0000000000c5', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Uygunsuz', '05321230005', 'disqualified', null, 0, 0, now(), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-0000000000c6', '10000000-0000-4000-8000-0000000000c1', 'Silinen Kurgu', '05321231234', 'pending', null, 0, 0, now(), '30000000-0000-4000-8000-0000000000c6', null),
  ('40000000-0000-4000-8000-0000000000c7', '10000000-0000-4000-8000-0000000000c1', 'Deniz Müşteri', '05321230007', 'pending', null, 0, 0, now(), '30000000-0000-4000-8000-0000000000c3', null),
  ('40000000-0000-4000-8000-0000000000c8', '10000000-0000-4000-8000-0000000000c1', 'Vural Görür', '05321230008', 'pending', null, 0, 0, now(), null, null),
  ('40000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Tekrar', '05321230009', 'retry', null, 0, 1, now(), '30000000-0000-4000-8000-0000000000c2', null),
  ('40000000-0000-4000-8000-000000000c10', '10000000-0000-4000-8000-0000000000c1', 'Kurgu Yarın', '05321230010', 'pending', null, 0, 0, now(),
   '30000000-0000-4000-8000-0000000000c2', now() - interval '10 days'),
  ('40000000-0000-4000-8000-000000000c11', '10000000-0000-4000-8000-0000000000c1', 'Bakım Silinen', '05321230011', 'pending', null, 0, 0, now(), null, null);

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000c1', public.tr_today(), x.c::uuid, x.m::uuid, x.p
from (values
  ('40000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c2', 1),
  ('40000000-0000-4000-8000-0000000000c2', '30000000-0000-4000-8000-0000000000c2', 2),
  ('40000000-0000-4000-8000-0000000000c3', '30000000-0000-4000-8000-0000000000c2', 3),
  ('40000000-0000-4000-8000-0000000000c4', '30000000-0000-4000-8000-0000000000c2', 4),
  ('40000000-0000-4000-8000-0000000000c5', '30000000-0000-4000-8000-0000000000c2', 5),
  ('40000000-0000-4000-8000-0000000000c9', '30000000-0000-4000-8000-0000000000c2', 6),
  ('40000000-0000-4000-8000-000000000c10', '30000000-0000-4000-8000-0000000000c2', 7),
  ('40000000-0000-4000-8000-0000000000c6', '30000000-0000-4000-8000-0000000000c6', 1),
  ('40000000-0000-4000-8000-0000000000c7', '30000000-0000-4000-8000-0000000000c3', 1)
) as x(c, m, p);

-- ---------------------------------------------------------------------------
-- Y1. log_call yalnız pending/retry müşteride (ajan Zeynep)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
set local role authenticated;

select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c2', 'no_answer')$$,
  '22023', 'Bu müşteri için arama kaydı açık değil (durum: havuzda).', 'Y1: havuzdaki müşteriye arama kaydı girilemez');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c3', 'busy')$$,
  '22023', 'Bu müşteri için arama kaydı açık değil (durum: tamamlandı).', 'Y1: tamamlanmış müşteri diriltilemez');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c4', 'no_answer')$$,
  '22023', 'Bu müşteri için arama kaydı açık değil (durum: ulaşılamadı).', 'Y1: ulaşılamadı müşteriye kayıt girilemez');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c5', 'appointment')$$,
  '22023', 'Bu müşteri için arama kaydı açık değil (durum: uygun değil).', 'Y1: uygun değil müşteriye kayıt girilemez');
select is((select call_status || '/' || pipeline_stage || '/' || pool_count
           from public.customers where id = '40000000-0000-4000-8000-0000000000c3'),
          'done/appointment/0', 'Y1: reddedilen kayıt müşteriyi değiştirmez');
select is((select count(*)::int from public.call_attempts where customer_id in (
             '40000000-0000-4000-8000-0000000000c2', '40000000-0000-4000-8000-0000000000c3',
             '40000000-0000-4000-8000-0000000000c4', '40000000-0000-4000-8000-0000000000c5')),
          0, 'Y1: reddedilen kayıt call_attempts satırı eklemez');
select is((select call_status from public.log_call('40000000-0000-4000-8000-0000000000c1', 'appointment')),
          'done', 'Y1: bekleyen müşteriye kayıt girilir');
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c1', 'busy')$$,
  '22023', 'Bu müşteri için arama kaydı açık değil (durum: tamamlandı).', 'Y1: aynı müşteriye ikinci dokunuş reddedilir');
select is((select call_status || '/' || attempts_in_round
           from public.log_call('40000000-0000-4000-8000-0000000000c9', 'no_answer')),
          'retry/2', 'Y1: tekrar (retry) müşteriye kayıt girilir');
reset role;

-- yönetici de kapalı müşteriye arama kaydı giremez; aşamayı set_pipeline_stage ile ilerletir
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.log_call('40000000-0000-4000-8000-0000000000c3', 'appointment')$$,
  '22023', null, 'Y1: yönetici de kapalı müşteriye arama kaydı giremez');
select is((select pipeline_stage from public.set_pipeline_stage('40000000-0000-4000-8000-0000000000c3', 'visited')),
          'visited', 'Y1: huni ilerlemesi set_pipeline_stage ile yapılır');
reset role;

-- ---------------------------------------------------------------------------
-- O1. customers insert yalnız import_customers RPC'si üzerinden
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.customers', 'INSERT'),
          'O1: authenticated customers tablosuna INSERT yetkisi taşımaz');
select is_empty($$select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and cmd = 'INSERT'$$,
                'O1: customers üzerinde insert politikası yok');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c4","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.customers (tenant_id, full_name, phone, call_status, assigned_to, next_call_at)
                   values ('10000000-0000-4000-8000-0000000000c1', 'Probe', '05559990003', 'retry',
                           '30000000-0000-4000-8000-0000000000c6', '2000-01-01')$$,
                 '42501', null, 'O1: import_customers yetkili ajan doğrudan insert yapamaz');
select is((select (public.import_customers('[{"full_name":"RPC Ekledi","phone":"05321239999"}]'::jsonb, 'elle') ->> 'inserted')::int),
          1, 'O1: import_customers yetkili ajan RPC ile ekler');
reset role;
select is((select call_status || '/' || source || '/' || coalesce(assigned_to::text, '-')
           from public.customers where phone = '05321239999'),
          'pending/import/-', 'O1: RPC ile eklenen müşteri kural motorunun varsayılanlarıyla başlar');
select is((select count(*)::int from public.audit_log
           where action = 'import_customers' and member_id = '30000000-0000-4000-8000-0000000000c4'
             and (data ->> 'inserted')::int = 1),
          1, 'O1: import_customers audit_log özet satırı yazar');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into public.customers (tenant_id, full_name, phone)
                   values ('10000000-0000-4000-8000-0000000000c1', 'Yönetici Doğrudan', '05559990004')$$,
                 '42501', null, 'O1: yönetici de doğrudan insert yapamaz');
reset role;

-- ---------------------------------------------------------------------------
-- O2. delete_customer görünürlük, maskeli audit, tek satır
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000c6')$$,
  '42501', 'Müşteri bulunamadı veya bu müşteriyi görme yetkiniz yok.',
  'O2: delete_customers yetkili ajan göremediği müşteriyi silemez');
select lives_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000c7', 'talep')$$,
                'O2: delete_customers yetkili ajan kendi bugünkü müşterisini siler');
reset role;
select is((select count(*)::int from public.customers where id = '40000000-0000-4000-8000-0000000000c6'),
          1, 'O2: göremediği müşteri silinmedi');
select is((select count(*)::int from public.audit_log where entity_id = '40000000-0000-4000-8000-0000000000c7'),
          1, 'O2: silme tek audit satırı yazar');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c5","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000c8')$$,
                'O2: view_all_customers + delete_customers ajan atanmamış müşteriyi siler');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.delete_customer('40000000-0000-4000-8000-0000000000c6', 'KVKK')$$,
                'O2: yönetici her müşteriyi siler');
reset role;
select is((select count(*)::int from public.audit_log where entity_id = '40000000-0000-4000-8000-0000000000c6'),
          1, 'O2: yönetici silmesi de tek audit satırı');
select is((select data ->> 'initials' from public.audit_log
           where action = 'customer_deleted' and entity_id = '40000000-0000-4000-8000-0000000000c6'),
          'S. K.', 'O2: audit adı baş harflerle yazar');
select is((select data ->> 'phone' from public.audit_log
           where action = 'customer_deleted' and entity_id = '40000000-0000-4000-8000-0000000000c6'),
          '•••• 1234', 'O2: audit telefonu son 4 hane maskeli');
select is((select count(*)::int from public.audit_log
           where action = 'customer_deleted'
             and entity_id in ('40000000-0000-4000-8000-0000000000c6', '40000000-0000-4000-8000-0000000000c7',
                               '40000000-0000-4000-8000-0000000000c8')
             and (data ? 'full_name' or data::text like '%Silinen%' or data::text like '%Deniz Müşteri%')),
          0, 'O2: audit tam adı içermez');

-- RPC dışı silme (bakım/service role) tetikleyiciyle kayda geçer
delete from public.customers where id = '40000000-0000-4000-8000-000000000c11';
select is((select count(*)::int from public.audit_log
           where action = 'customer_delete' and entity_id = '40000000-0000-4000-8000-000000000c11'),
          1, 'O2: RPC dışı silme tetikleyiciyle audit_log yazar');

-- ---------------------------------------------------------------------------
-- O3. distribute_day yalnız bugün; ileri gün bugünkü assigned_to'yu bozmaz
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.distribute_day(public.tr_today() + 1)$$,
  '22023', 'Dağıtım yalnız bugün için yapılabilir.', 'O3: yarın için manuel dağıtım reddedilir');
select throws_ok($$select public.distribute_day(public.tr_today() - 1)$$,
  '22023', 'Dağıtım yalnız bugün için yapılabilir.', 'O3: geçmiş gün için manuel dağıtım reddedilir');
select lives_ok($$select public.distribute_day(public.tr_today())$$, 'O3: bugün için açık gün parametresi kabul edilir');
reset role;

select ok(public._distribute_day_for('10000000-0000-4000-8000-0000000000c1', public.tr_today() + 1) > 0,
          'O3: iç fonksiyon yarın için dağıtım yapar');
select ok(exists(select 1 from public.daily_assignments t
                 join public.daily_assignments n on n.customer_id = t.customer_id
                 where t.day = public.tr_today() and n.day = public.tr_today() + 1 and t.member_id <> n.member_id),
          'O3: senaryo geçerli (bugünkü bir müşteri yarın başka ajana atandı)');
select is((select count(*)::int from public.customers c
           join public.daily_assignments d on d.customer_id = c.id and d.day = public.tr_today()
           where c.assigned_to is distinct from d.member_id),
          0, 'O3: yarın dağıtımı bugünkü assigned_to değerlerini değiştirmez');

-- bugünkü dağıtım tutarsız assigned_to'yu bugünkü atamaya eşitler
update public.customers set assigned_to = '30000000-0000-4000-8000-0000000000c6'
where id = '40000000-0000-4000-8000-000000000c10';
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.distribute_day()$$, 'O3: bugünkü dağıtım çalışır');
reset role;
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-000000000c10'),
          '30000000-0000-4000-8000-0000000000c2'::uuid, 'O3: bugünkü dağıtım assigned_to''yu bugünkü atamayla eşitler');

-- ---------------------------------------------------------------------------
-- D4. mark_absent ve reassign_customer dağıtım kilidini alır
-- ---------------------------------------------------------------------------
select ok(pg_get_functiondef('public.mark_absent(uuid, date)'::regprocedure) like '%pg_advisory_xact_lock%',
          'D4: mark_absent dağıtım kilidini alır');
select ok(pg_get_functiondef('public.reassign_customer(uuid, uuid)'::regprocedure) like '%pg_advisory_xact_lock%',
          'D4: reassign_customer dağıtım kilidini alır');

-- ---------------------------------------------------------------------------
-- D2. members kolon yetkisi ve son aktif yönetici koruması
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$update public.members set user_id = '20000000-0000-4000-8000-0000000000c7'
                   where id = '30000000-0000-4000-8000-0000000000c2'$$,
                 '42501', null, 'D2: yönetici üyenin user_id alanını değiştiremez');
select throws_ok($$update public.members set role = 'agent' where id = '30000000-0000-4000-8000-0000000000c1'$$,
                 '22023', 'Kiracıda en az bir aktif yönetici kalmalı. Önce başka bir yönetici atayın.',
                 'D2: son aktif yöneticinin rolü düşürülemez');
select throws_ok($$update public.members set is_active = false where id = '30000000-0000-4000-8000-0000000000c1'$$,
                 '22023', null, 'D2: son aktif yönetici pasifleştirilemez');
reset role;

insert into public.members (id, tenant_id, user_id, full_name, role) values
  ('30000000-0000-4000-8000-0000000000c7', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c7', 'İkinci Yönetici', 'manager');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
with u as (update public.members set role = 'agent' where id = '30000000-0000-4000-8000-0000000000c7' returning 1)
select is(count(*)::int, 1, 'D2: başka aktif yönetici varken rol düşürülebilir') from u;
reset role;

select * from finish();
rollback;
