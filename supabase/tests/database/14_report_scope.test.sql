-- Rapor kapsamı ve view_team (migration 20261004001100_report_scope_view_team.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Geçiş: view_reports sahiplerinin hepsinde view_team var (fixture'dan önce, mevcut veri üzerinde)
select is((select count(*)::int from public.members
           where permissions -> 'view_reports' = 'true'::jsonb and not (permissions ? 'view_team')),
          0, 'geçiş: view_reports sahiplerine view_team verildi');

-- ---------------------------------------------------------------------------
-- Fixture (hepsi kurgusal)
-- Kiracı e1: Yönetici (e1), Zeynep ajan yetkisiz (e2), Deniz ajan view_reports (e3), Tolga ajan view_team (e4)
-- Kiracı e2: Öteki Yönetici (e5)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'rs-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'rs-zey@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'rs-den@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e4', 'authenticated', 'authenticated', 'rs-tol@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'rs-oth@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Kapsam Kiracı'),
  ('10000000-0000-4000-8000-0000000000e2', 'Öteki Kapsam Kiracı');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Kapsam Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Zeynep Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e3', 'Deniz Ajan', 'agent', '{"view_reports": true}'),
  ('30000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e4', 'Tolga Ajan', 'agent', '{"view_team": true}'),
  ('30000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e5', 'Öteki Yönetici', 'manager', '{}');

insert into public.customers (id, tenant_id, full_name, phone, operator, source_detail, call_status, next_call_at, assigned_to, created_at) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Bir', '05321250001', 'VF', 'Meta A', 'done', now(), '30000000-0000-4000-8000-0000000000e2', now()),
  ('40000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', 'Kurgu İki', '05321250002', 'TC', 'Meta B', 'retry', now(), '30000000-0000-4000-8000-0000000000e2', now()),
  ('40000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Üç', '05321250003', 'TT', 'Meta A', 'done', now(), '30000000-0000-4000-8000-0000000000e3', now()),
  ('40000000-0000-4000-8000-0000000000e4', '10000000-0000-4000-8000-0000000000e1', 'Kurgu Dört', '05321250004', null, null, 'retry', now(), '30000000-0000-4000-8000-0000000000e4', now()),
  ('40000000-0000-4000-8000-0000000000e5', '10000000-0000-4000-8000-0000000000e2', 'Kurgu Beş', '05321250005', null, null, 'pending', now(), '30000000-0000-4000-8000-0000000000e5', now());

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select '10000000-0000-4000-8000-0000000000e1', public.tr_today(), x.c::uuid, x.m::uuid, x.p
from (values
  ('40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 1),
  ('40000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 2),
  ('40000000-0000-4000-8000-0000000000e3', '30000000-0000-4000-8000-0000000000e3', 1),
  ('40000000-0000-4000-8000-0000000000e4', '30000000-0000-4000-8000-0000000000e4', 1)
) as x(c, m, p);

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, created_at) values
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'appointment', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e2', '30000000-0000-4000-8000-0000000000e2', 'no_answer', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e3', '30000000-0000-4000-8000-0000000000e3', 'callback', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e4', '30000000-0000-4000-8000-0000000000e4', 'busy', now());

-- Mağazada yönetici işaretler: e1 geldi ve tamamlandı (Zeynep'in müşterisi), e3 reddedildi (Deniz'in müşterisi)
insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, created_at) values
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'appointment', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e1', 'visited', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e1', 'completed', now()),
  ('10000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e3', '30000000-0000-4000-8000-0000000000e1', 'rejected', now());

insert into public.audit_log (tenant_id, member_id, action, entity, entity_id, data, created_at) values
  ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e2', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000e2', '{"call_status":"pool"}', now()),
  ('10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e4', 'log_call', 'customer', '40000000-0000-4000-8000-0000000000e4', '{"call_status":"unreachable"}', now());

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public._report_range(uuid, uuid, date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public._report_range(uuid, uuid, date, date)', 'EXECUTE'),
          'yetki: _report_range istemci rollerine kapalı');
select ok(not has_function_privilege('anon', 'public.report_range_member(date, date, uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.report_range(date, date)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.day_summary(date)', 'EXECUTE'),
          'yetki: rapor fonksiyonları anon''a kapalı');
select ok(has_function_privilege('authenticated', 'public.report_range_member(date, date, uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.report_range(date, date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.day_summary(date)', 'EXECUTE'),
          'yetki: rapor fonksiyonları authenticated''a açık');

-- ---------------------------------------------------------------------------
-- Zeynep (yetkisiz ajan): yalnız kendi sayıları
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope'),
          'member', 'kapsam: yetkisiz ajan üye kapsamı alır');
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'member_id'),
          '30000000-0000-4000-8000-0000000000e2', 'kapsam: üye kapsamı çağıranın kendisi');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals'),
          '{"attempts":2,"customers_called":2,"reached":1,"appointments":1,"visited":1,"applied":0,"approved":0,
            "completed":1,"rejected":0,"not_interested":0,"disqualified":0,"pooled":1,"unreachable":0,
            "new_customers":2,"assigned":2}'::jsonb,
          'kapsam: ajanın totals yalnız kendi (atanan, aranan, ulaşılan, gelen, tamamlanan)');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'rates'),
          '{"reach_rate":0.5,"appointment_rate":1,"visit_rate":1,"close_rate":1}'::jsonb,
          'kapsam: ajanın oranları kendi sayılarından');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_member'),
          jsonb_build_array(jsonb_build_object('member_id', '30000000-0000-4000-8000-0000000000e2', 'full_name', 'Zeynep Ajan',
            'attempts', 2, 'customers_called', 2, 'reached', 1, 'appointments', 1, 'completed', 0)),
          'kapsam: by_member yalnız kendi satırı');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_day'),
          jsonb_build_array(jsonb_build_object('day', public.tr_today(), 'attempts', 2, 'reached', 1, 'appointments', 1)),
          'kapsam: trend yalnız kendi denemeleri');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_source'),
          '[{"source_detail":"Meta A","customers":1,"appointments":1,"completed":1},
            {"source_detail":"Meta B","customers":1,"appointments":0,"completed":0}]'::jsonb,
          'kapsam: kaynak kırılımı yalnız kendi müşterileri');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'by_operator'),
          '[{"operator":"TC","customers":1,"completed":0},{"operator":"VF","customers":1,"completed":1}]'::jsonb,
          'kapsam: operatör kırılımı yalnız kendi müşterileri');
select is((select jsonb_array_length(public.report_range(public.tr_today(), public.tr_today()) -> 'by_outcome')),
          2, 'kapsam: sonuç dağılımı yalnız kendi denemeleri');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e2') -> 'totals' ->> 'attempts'),
          '2', 'kapsam: ajan kendi member_id ile isteyebilir');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e3')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'kapsam: ajan başkasının member_id''sini isteyemez');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e1')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'kapsam: ajan yöneticinin member_id''sini isteyemez');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e5')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'kapsam: ajan başka kiracının üyesini isteyemez');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), null)$$,
                 '22023', 'Çalışan seçilmedi.', 'kapsam: boş member_id reddedilir');
select throws_ok($$select public.report_range(public.tr_today() - 366, public.tr_today())$$,
                 '22023', 'Rapor aralığı en fazla 366 gün olabilir.', 'kapsam: aralık sınırı üye kapsamında da geçerli');
select throws_ok($$select public._report_range('10000000-0000-4000-8000-0000000000e1', null, public.tr_today(), public.tr_today())$$,
                 '42501', null, 'kapsam: iç fonksiyon doğrudan çağrılamaz');
select throws_ok($$select * from public.day_summary()$$, '42501', 'Ekip özetini görme yetkiniz yok.',
                 'view_team: yetkisiz ajan ekip özetini alamaz');
select is((select count(*)::int from public.daily_assignments), 2, 'view_team: yetkisiz ajan yalnız kendi atamalarını görür');
reset role;

-- ---------------------------------------------------------------------------
-- Deniz (view_reports, view_team yok): Raporlar ekip geneli; Yönetim verisi kısmen
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope'),
          'team', 'view_reports: ekip kapsamı');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          '4', 'view_reports: ekip geneli deneme');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'assigned'),
          '4', 'view_reports: ekip geneli atama');
select is((select jsonb_array_length(public.report_range(public.tr_today(), public.tr_today()) -> 'by_member')),
          4, 'view_reports: by_member tüm ekip');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e2') -> 'totals' ->> 'attempts'),
          '2', 'view_reports: tek çalışanın kapsamını isteyebilir');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e3') -> 'totals' ->> 'rejected'),
          '1', 'view_reports: Ben görünümü, mağazada işaretlenen ret kendi müşterisinde sayılır');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e5')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'view_reports: başka kiracının üyesi istenemez');
select is((select count(*)::int from public.daily_assignments), 1,
          'view_reports: view_team olmadan başkalarının atamaları görünmez');
select is((select count(*)::int from public.day_summary()), 3, 'view_reports: ekip özeti (toplam) açık');
reset role;

-- ---------------------------------------------------------------------------
-- Tolga (view_team, view_reports yok): Yönetim verisi var, rapor yalnız kendisi
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e4","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope'),
          'member', 'view_team: raporda ekip kapsamı vermez');
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts') || '/' ||
          (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'unreachable'),
          '1/1', 'view_team: kendi sayıları');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e2')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'view_team: başkasının rapor kapsamını isteyemez');
select is((select count(*)::int from public.day_summary()), 3, 'view_team: ekip özeti açık');
select is((select count(*)::int from public.daily_assignments), 4, 'view_team: ekibin atamalarını görür');
reset role;

-- ---------------------------------------------------------------------------
-- Yönetici: ekip ve Ben
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) ->> 'scope') || '/' ||
          (public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          'team/4', 'yönetici: ekip kapsamı');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e1') ->> 'scope'),
          'member', 'yönetici: Ben görünümü üye kapsamı');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e1') -> 'totals'),
          '{"attempts":0,"customers_called":0,"reached":0,"appointments":0,"visited":1,"applied":0,"approved":0,
            "completed":1,"rejected":1,"not_interested":0,"disqualified":0,"pooled":0,"unreachable":0,
            "new_customers":0,"assigned":0}'::jsonb,
          'yönetici: Ben görünümü kendi işaretlediği aşamalar');
select is((select jsonb_array_length(public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e1') -> 'by_member')),
          1, 'yönetici: Ben görünümünde tek satır (hareketsiz olsa da)');
select is((select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e4') -> 'totals' ->> 'attempts'),
          '1', 'yönetici: herhangi bir çalışanın kapsamı');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e5')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'yönetici: başka kiracının üyesi istenemez');
select is((select count(*)::int from public.daily_assignments), 4, 'yönetici: tüm atamaları görür');
reset role;

-- Başka kiracı: veri karışmaz
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e5","role":"authenticated"}', true);
set local role authenticated;
select is((select public.report_range(public.tr_today(), public.tr_today()) -> 'totals' ->> 'attempts'),
          '0', 'kiracı: başka kiracının verisi karışmaz');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e2')$$,
                 '42501', 'Bu çalışanın raporunu görme yetkiniz yok.', 'kiracı: başka kiracının çalışanı istenemez');
reset role;

-- Oturumsuz authenticated (üyelik yok): reddedilir
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000ff","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.report_range(public.tr_today(), public.tr_today())$$, '42501', null,
                 'üyeliksiz: rapor reddedilir');
select throws_ok($$select public.report_range_member(public.tr_today(), public.tr_today(), '30000000-0000-4000-8000-0000000000e2')$$,
                 '42501', null, 'üyeliksiz: üye raporu reddedilir');
reset role;

select * from finish();
rollback;
