-- Kayıp müşteriler: pasifleştirme, sayım ve kurtarma (migration 20261008000600_lost_customers.sql)
-- Not: 'unlisted' kategorisi dağıtım saati + 15 dk geçtikten sonra sayılır; test kiracısında saat 00:00,
-- bu yüzden test İstanbul saatiyle 00:00-00:15 arasında çalışırsa unlisted sayımları 0 olur.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'lc-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'lc-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'lc-a2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e4', 'authenticated', 'authenticated', 'lc-team@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'lc-absent@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e6', 'authenticated', 'authenticated', 'lc-old@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'lc-bmgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'lc-bold@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Test Kiracı LC'),
  ('10000000-0000-4000-8000-0000000000f1', 'Test Kiracı LC B');

update public.tenant_settings set distribution_mode = 'free_pool', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000e1';
update public.tenant_settings set distribution_mode = 'auto_even', distribution_hour = 0, distribution_minute = 0
where tenant_id = '10000000-0000-4000-8000-0000000000f1';

insert into public.members (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Yönetici LC', 'manager', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Ajan Bir LC', 'agent', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e3', 'Ajan İki LC', 'agent', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Ekip Lideri LC', 'agent', '{"view_team": true}', true, null),
  ('30000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e5', 'İzinli LC', 'agent', '{}', true, public.tr_today()),
  ('30000000-0000-4000-8000-0000000000e6', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e6', 'Eski Ajan LC', 'agent', '{}', false, null),
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Yönetici LC B', 'manager', '{}', true, null),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Eski Ajan LC B', 'agent', '{}', false, null);

-- Ajan Bir'in müşterileri (pasifleştirme senaryosu)
insert into public.customers (id, tenant_id, full_name, phone, call_status, assigned_to, attempts_in_round, next_call_at) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Açık LC', '05327773001', 'pending', '30000000-0000-4000-8000-0000000000e2', 2, now() - interval '2 hours'),
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', 'Kurgu İleri LC', '05327773002', 'retry', '30000000-0000-4000-8000-0000000000e2', 1, public.tr_day_start(public.tr_today() + 3)),
  ('40000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Kapalı LC', '05327773003', 'done', '30000000-0000-4000-8000-0000000000e2', 0, now() - interval '2 hours');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 1);

-- Yetkiler
select ok(not has_function_privilege('anon', 'public.deactivate_member(uuid)', 'EXECUTE'), 'anon deactivate_member çağıramaz');
select ok(has_function_privilege('authenticated', 'public.deactivate_member(uuid)', 'EXECUTE'), 'authenticated deactivate_member çağırır');
select ok(not has_function_privilege('anon', 'public.lost_customers()', 'EXECUTE'), 'anon lost_customers çağıramaz');
select ok(has_function_privilege('authenticated', 'public.lost_customers()', 'EXECUTE'), 'authenticated lost_customers çağırır');
select ok(not has_function_privilege('anon', 'public.rescue_lost_customers()', 'EXECUTE'), 'anon rescue_lost_customers çağıramaz');
select ok(has_function_privilege('authenticated', 'public.rescue_lost_customers()', 'EXECUTE'), 'authenticated rescue_lost_customers çağırır');
select ok(not has_function_privilege('authenticated', 'public._lost_customer_rows(uuid)', 'EXECUTE'), 'iç sayım fonksiyonu istemciye kapalı');
select ok(not has_function_privilege('authenticated', 'public._release_to_queue(uuid, uuid[])', 'EXECUTE'), 'iç bırakma fonksiyonu istemciye kapalı');

-- (b) Yetkisiz çağrılar: çalışan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.deactivate_member('30000000-0000-4000-8000-0000000000e2')$$, '42501', 'Bu işlem için yönetici olmalısınız.', 'çalışan pasifleştiremez');
select throws_ok($$select public.lost_customers()$$, '42501', 'Bu bilgiyi görme yetkiniz yok.', 'yetkisiz çalışan kayıp sayısını göremez');
select throws_ok($$select public.rescue_lost_customers()$$, '42501', 'Bu işlem için yönetici olmalısınız.', 'çalışan kurtarma yapamaz');
reset role;

-- view_team: sayıyı görür, kurtaramaz
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e4","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.lost_customers()$$, 'view_team izni olan kayıp sayısını görür');
select throws_ok($$select public.rescue_lost_customers()$$, '42501', 'Bu işlem için yönetici olmalısınız.', 'view_team kurtarma yapamaz');
reset role;

-- (f) Başka kiracının yöneticisi bu kiracının çalışanını pasifleştiremez
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.deactivate_member('30000000-0000-4000-8000-0000000000e2')$$, '42501', 'Çalışan bulunamadı.', 'başka kiracının çalışanı pasifleştirilemez');
reset role;
select is((select is_active from public.members where id = '30000000-0000-4000-8000-0000000000e2'), true, 'başka kiracı çağrısı çalışanı değiştirmez');

-- (c) Kendini ve son yöneticiyi pasifleştirme
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.deactivate_member('30000000-0000-4000-8000-0000000000e1')$$, '22023', 'Kendinizi pasifleştiremezsiniz.', 'yönetici kendini pasifleştiremez');
reset role;
select throws_ok($$update public.members set is_active = false where id = '30000000-0000-4000-8000-0000000000e1'$$, '22023',
  'Kiracıda en az bir aktif yönetici kalmalı. Önce başka bir yönetici atayın.', 'son aktif yönetici pasifleştirilemez');

-- (a) Serbest havuzda pasifleştirme: açık müşteriler sahipsiz pending olur
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is(public.deactivate_member('30000000-0000-4000-8000-0000000000e2'), 2, 'iki açık müşteri sıraya bırakılır');
reset role;

select is((select is_active from public.members where id = '30000000-0000-4000-8000-0000000000e2'), false, 'çalışan pasif olur');
select is((select call_status || '|' || coalesce(assigned_to::text, '') || '|' || attempts_in_round::text || '|' || (next_call_at <= now())::text
           from public.customers where id = '40000000-0000-4000-8000-0000000000e1'),
          'pending||0|true', 'açık müşteri sahipsiz, sayacı sıfır, vakti gelmiş pending');
select is((select call_status || '|' || coalesce(assigned_to::text, '') || '|' || (next_call_at = public.tr_day_start(public.tr_today() + 3))::text
           from public.customers where id = '40000000-0000-4000-8000-0000000000e2'),
          'pending||true', 'ileri tarihli tekrar araması sahipsiz pending olur, tarihi korunur');
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000e3'),
          '30000000-0000-4000-8000-0000000000e2'::uuid, 'kapanmış müşteriye dokunulmaz');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000e1'), 0, 'günlük atama satırı silinir');
select is((select count(*)::int from public.audit_log where action = 'deactivate_member' and entity_id = '30000000-0000-4000-8000-0000000000e2'), 1, 'pasifleştirme audit kaydı yazılır');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select is((public.claim_next()).id, '40000000-0000-4000-8000-0000000000e1'::uuid, 'bırakılan müşteri Sıradakini al ile alınır');
reset role;

-- (d) Kayıp kategorileri
insert into public.customers (id, tenant_id, full_name, phone, call_status, assigned_to, consent, next_call_at) values
  -- owner_inactive
  ('40000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Pasif Bir', '05327774001', 'pending', '30000000-0000-4000-8000-0000000000e6', true, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Pasif İki', '05327774002', 'retry', '30000000-0000-4000-8000-0000000000e6', true, now() - interval '1 hour'),
  -- sayılmaz: ileri tarih, kapalı, izinsiz
  ('40000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Pasif İleri', '05327774003', 'pending', '30000000-0000-4000-8000-0000000000e6', true, public.tr_day_start(public.tr_today() + 2)),
  ('40000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Pasif Kapalı', '05327774004', 'done', '30000000-0000-4000-8000-0000000000e6', true, now() - interval '1 hour'),
  ('40000000-0000-4000-8000-0000000000a5', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Pasif İzinsiz', '05327774005', 'pending', '30000000-0000-4000-8000-0000000000e6', false, now() - interval '1 hour'),
  -- owner_absent
  ('40000000-0000-4000-8000-0000000000a6', '10000000-0000-4000-8000-0000000000e1', 'Kurgu İzinli Sahip', '05327774006', 'pending', '30000000-0000-4000-8000-0000000000e5', true, now() - interval '1 hour'),
  -- unowned_retry
  ('40000000-0000-4000-8000-0000000000a7', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Sahipsiz Tekrar', '05327774007', 'retry', null, true, now() - interval '1 hour'),
  -- sayılmaz: sahipsiz pending (kuyruk)
  ('40000000-0000-4000-8000-0000000000a8', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Kuyruk', '05327774008', 'pending', null, true, now() - interval '1 hour'),
  -- unlisted
  ('40000000-0000-4000-8000-0000000000a9', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Listesiz', '05327774009', 'retry', '30000000-0000-4000-8000-0000000000e3', true, now() - interval '1 hour'),
  -- sayılmaz: listede
  ('40000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Listede', '05327774010', 'pending', '30000000-0000-4000-8000-0000000000e3', true, now() - interval '1 hour'),
  -- B kiracısı: pasif sahipli tekrar araması
  ('40000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000f1', 'Kurgu B Pasif', '05327774011', 'retry', '30000000-0000-4000-8000-0000000000f2', true, now() - interval '1 hour');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-0000000000e3', 99),
  ('10000000-0000-4000-8000-0000000000e1', public.tr_today(), '40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000e6', 1);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is(public.lost_customers(),
          '{"total":5,"owner_inactive":2,"owner_absent":1,"unlisted":1,"unowned_retry":1}'::jsonb,
          'her kategori ayrık ve doğru sayılır');
reset role;

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e4","role":"authenticated"}', true);
set local role authenticated;
select is((public.lost_customers()) ->> 'total', '5', 'view_team aynı sayıyı görür');
reset role;

-- (e) Kurtarma yalnız owner_inactive ve unowned_retry
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is(public.rescue_lost_customers(), 3, 'üç müşteri sıraya bırakılır');
select is(public.lost_customers(),
          '{"total":2,"owner_inactive":0,"owner_absent":1,"unlisted":1,"unowned_retry":0}'::jsonb,
          'kurtarma sonrası pasif sahipli ve sahipsiz tekrar 0');
reset role;

select is((select string_agg(call_status || '|' || coalesce(assigned_to::text, '-'), ',' order by id) from public.customers
           where id in ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-0000000000a7')),
          'pending|-,pending|-,pending|-', 'kurtarılanlar sahipsiz pending');
select is((select count(*)::int from public.daily_assignments where customer_id = '40000000-0000-4000-8000-0000000000a1'), 0, 'kurtarılanın günlük satırı silinir');
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000a6'),
          '30000000-0000-4000-8000-0000000000e5'::uuid, 'izinli sahibin müşterisine dokunulmaz');
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000a9'),
          '30000000-0000-4000-8000-0000000000e3'::uuid, 'listede olmayan müşteriye dokunulmaz');
select is((select assigned_to::text || '|' || call_status from public.customers where id = '40000000-0000-4000-8000-0000000000a3'),
          '30000000-0000-4000-8000-0000000000e6|pending', 'vakti gelmemiş müşteriye dokunulmaz');
select is((select count(*)::int from public.audit_log where action = 'rescue_lost_customers' and tenant_id = '10000000-0000-4000-8000-0000000000e1'), 1, 'kurtarma audit kaydı yazılır');

-- (f) B kiracısı sızmaz; auto_even'de kurtarma yalnız sahipliği boşaltır
select is((select assigned_to from public.customers where id = '40000000-0000-4000-8000-0000000000c9'),
          '30000000-0000-4000-8000-0000000000f2'::uuid, 'A kiracısının kurtarması B müşterisine dokunmaz');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select is(public.lost_customers(),
          '{"total":1,"owner_inactive":1,"owner_absent":0,"unlisted":0,"unowned_retry":0}'::jsonb,
          'B kiracısı yalnız kendi kayıp müşterisini görür');
select is(public.rescue_lost_customers(), 1, 'B kiracısında bir müşteri kurtarılır');
reset role;
select is((select call_status || '|' || coalesce(assigned_to::text, '-') from public.customers where id = '40000000-0000-4000-8000-0000000000c9'),
          'retry|-', 'auto_even modunda durum korunur, sahiplik boşalır');

select * from finish();
rollback;
