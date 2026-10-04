begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'mr-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mr-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mr-a2@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager', '{}'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'B Ajan', 'agent', '{"view_reports": true, "reassign": true}');

insert into public.customers (id, tenant_id, full_name, phone, birth_date, assigned_to) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Doğum Günü Yakın', '05326660001',
   (public.tr_today() + 3 - interval '30 years')::date, '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Doğum Günü Uzak', '05326660002',
   (public.tr_today() + 10 - interval '25 years')::date, '30000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Doğum Günü Yok', '05326660003',
   null, '30000000-0000-4000-8000-000000000002');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values
  ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 1),
  ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 2),
  ('10000000-0000-4000-8000-000000000001', public.tr_today(), '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 1);

-- 29 Şubat hesabı
select is(public.birthday_next('2000-02-29', '2027-02-27'), '2027-02-28'::date, '29 Şubat artık olmayan yılda 28 Şubat');
select is(public.birthday_next('2000-02-29', '2028-02-28'), '2028-02-28'::date, '29 Şubat artık yılda da 28 Şubat sayılır');
select is(public.birthday_next('1990-01-10', '2026-12-30'), '2027-01-10'::date, 'yıl dönümü sonraki yıla geçer');

-- ---------------------------------------------------------------------------
-- Yönetici
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.rules_summary_text(),
  'Ulaşılamayan müşteri aynı gün tekrar aranır. 3 başarısız denemeden sonra havuza düşer ve 7 gün sonra listeye geri çıkar. Havuza en fazla 2 kez düşer, sonra ''ulaşılamadı'' olarak kapanır.',
  'rules_summary_text varsayılan ayarlarla örnek metni üretir');

update public.tenant_settings set max_attempts = 4, pool_wait_days = 10, max_rounds = 1;
select is(public.rules_summary_text(),
  'Ulaşılamayan müşteri aynı gün tekrar aranır. 4 başarısız denemeden sonra havuza düşer ve 10 gün sonra listeye geri çıkar. Havuza en fazla 1 kez düşer, sonra ''ulaşılamadı'' olarak kapanır.',
  'rules_summary_text ayar değişikliğini yansıtır');

select results_eq($$select customer_id, days_left from public.upcoming_birthdays()$$,
                  $$values ('40000000-0000-4000-8000-000000000001'::uuid, 3)$$,
                  'upcoming_birthdays varsayılan 3 gün içindekini döner');
select is((select count(*)::int from public.upcoming_birthdays(10)), 2, 'upcoming_birthdays(10) iki müşteri döner');
select is((select days_left from public.upcoming_birthdays(10) where customer_id = '40000000-0000-4000-8000-000000000002'),
          10, 'days_left doğru');

-- day_summary
select is((select assigned from public.day_summary() where member_id = '30000000-0000-4000-8000-000000000002'),
          2, 'day_summary atanan sayısı');
do $$ begin perform public.log_call('40000000-0000-4000-8000-000000000001', 'appointment'); end $$;
select is((select done || '/' || reached || '/' || appointments from public.day_summary()
           where member_id = '30000000-0000-4000-8000-000000000002'),
          '1/0/0', 'day_summary: biten 1; ulaşma ve randevu çağıran üyeye yazılır');
select is((select count(*)::int from public.day_summary()), 2,
          'day_summary aktif ajanları listeler (ataması olmayan yönetici yok)');

-- reassign_customer
select is((select assigned_to from public.reassign_customer('40000000-0000-4000-8000-000000000003',
                                                            '30000000-0000-4000-8000-000000000003')),
          '30000000-0000-4000-8000-000000000003'::uuid, 'reassign_customer assigned_to günceller');
select is((select member_id || ':' || position from public.daily_assignments
           where customer_id = '40000000-0000-4000-8000-000000000003' and day = public.tr_today()),
          '30000000-0000-4000-8000-000000000003:2', 'reassign_customer bugünkü atamayı taşır');
reset role;

-- ---------------------------------------------------------------------------
-- A Ajan
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.upcoming_birthdays(30)), 1,
          'upcoming_birthdays yalnız görünür müşterileri döner');
select throws_ok($$select * from public.day_summary()$$, '42501', 'Ekip özetini görme yetkiniz yok.',
                 'view_reports olmadan day_summary kapalı');
select throws_ok($$select public.reassign_customer('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003')$$,
                 '42501', 'Müşteri devretme yetkiniz yok.', 'reassign yetkisi olmadan devredemez');
select ok(public.rules_summary_text() like 'Ulaşılamayan müşteri%', 'ajan kural özetini okuyabilir');
reset role;

-- ---------------------------------------------------------------------------
-- B Ajan (view_reports, reassign)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.day_summary()), 2, 'view_reports ile day_summary açık');
select is((select assigned_to from public.reassign_customer('40000000-0000-4000-8000-000000000002',
                                                            '30000000-0000-4000-8000-000000000002')),
          '30000000-0000-4000-8000-000000000002'::uuid, 'reassign yetkili ajan kendi müşterisini devreder');
reset role;

-- login_branding (oturumsuz)
set local role anon;
select ok((select count(*) from public.login_branding()) <= 1, 'login_branding anon için çalışır, en fazla 1 satır');
reset role;

select * from finish();
rollback;
