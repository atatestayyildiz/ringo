-- Meta Lead Ads (migration 20261007000300_meta_leads.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'ml-mgr1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', 'ml-ajan1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', 'ml-mgr2@test.test');

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Test Kiracı ML1'),
  ('10000000-0000-4000-8000-0000000000e2', 'Test Kiracı ML2');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Yönetici ML1', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000e2', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e2', 'Ajan ML1', 'agent', '{"import_customers": true, "view_all_customers": true}'),
  ('30000000-0000-4000-8000-0000000000e3', '10000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e3', 'Yönetici ML2', 'manager', '{}');

-- Mevcut müşteriler (kiracı 1): açık kayıt ve 5 ay önce kapanmış kayıt
insert into public.customers (tenant_id, full_name, phone, call_status, pipeline_stage, updated_at) values
  ('10000000-0000-4000-8000-0000000000e1', 'Kurgu Açık', '05327770001', 'pending', null, now()),
  ('10000000-0000-4000-8000-0000000000e1', 'Kurgu Kapalı', '05327770002', 'done', 'completed', now() - interval '150 days');

-- ---------------------------------------------------------------------------
-- Tablolar: RLS
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.meta_connections'::regclass), 'meta_connections RLS açık');
select ok((select relrowsecurity from pg_class where oid = 'public.meta_leads'::regclass), 'meta_leads RLS açık');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name = 'meta_leads'
             and column_name in ('full_name', 'phone', 'name', 'note')), 0, 'meta_leads kişisel veri sütunu içermez');
select ok(not has_table_privilege('anon', 'public.meta_connections', 'SELECT'), 'anon meta_connections okuyamaz');
select ok(not has_table_privilege('authenticated', 'public.meta_connections', 'INSERT'), 'authenticated meta_connections yazamaz');
select ok(not has_table_privilege('authenticated', 'public.meta_leads', 'SELECT'), 'authenticated meta_leads okuyamaz');

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where proname = 'meta_connect' and pronamespace = 'public'::regnamespace), 0, 'eski meta_connect kaldırıldı');
select ok(not has_function_privilege('anon', 'public.meta_connect_for(uuid, text)', 'EXECUTE'), 'anon meta_connect_for çağıramaz');
select ok(not has_function_privilege('authenticated', 'public.meta_connect_for(uuid, text)', 'EXECUTE'), 'authenticated meta_connect_for çağıramaz');
select ok(has_function_privilege('service_role', 'public.meta_connect_for(uuid, text)', 'EXECUTE'), 'service_role meta_connect_for çağırır');
select ok(not has_function_privilege('anon', 'public.meta_status()', 'EXECUTE'), 'anon meta_status çağıramaz');
select ok(has_function_privilege('authenticated', 'public.meta_status()', 'EXECUTE'), 'authenticated meta_status çağırır');

select ok(not has_function_privilege('anon', 'public.meta_tenant_for_page(text)', 'EXECUTE'), 'anon meta_tenant_for_page çağıramaz');
select ok(not has_function_privilege('authenticated', 'public.meta_tenant_for_page(text)', 'EXECUTE'), 'authenticated meta_tenant_for_page çağıramaz');
select ok(has_function_privilege('service_role', 'public.meta_tenant_for_page(text)', 'EXECUTE'), 'service_role meta_tenant_for_page çağırır');

select ok(not has_function_privilege('anon', 'public.meta_connections_list()', 'EXECUTE'), 'anon meta_connections_list çağıramaz');
select ok(not has_function_privilege('authenticated', 'public.meta_connections_list()', 'EXECUTE'), 'authenticated meta_connections_list çağıramaz');
select ok(has_function_privilege('service_role', 'public.meta_connections_list()', 'EXECUTE'), 'service_role meta_connections_list çağırır');

select ok(not has_function_privilege('anon', 'public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text)', 'EXECUTE'), 'anon ingest_meta_lead çağıramaz');
select ok(not has_function_privilege('authenticated', 'public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text)', 'EXECUTE'), 'authenticated ingest_meta_lead çağıramaz');
select ok(has_function_privilege('service_role', 'public.ingest_meta_lead(uuid, text, text, timestamptz, text, text, text, text, text)', 'EXECUTE'), 'service_role ingest_meta_lead çağırır');

select ok(not has_function_privilege('anon', 'public.meta_record_status(uuid, boolean, text, boolean)', 'EXECUTE'), 'anon meta_record_status çağıramaz');
select ok(not has_function_privilege('authenticated', 'public.meta_record_status(uuid, boolean, text, boolean)', 'EXECUTE'), 'authenticated meta_record_status çağıramaz');
select ok(has_function_privilege('service_role', 'public.meta_record_status(uuid, boolean, text, boolean)', 'EXECUTE'), 'service_role meta_record_status çağırır');

select ok(not has_function_privilege('anon', 'public._ingest_customer_row(uuid, uuid, text, text, text, text, text, text, date, timestamptz, text)', 'EXECUTE'), 'anon _ingest_customer_row çağıramaz');
select ok(not has_function_privilege('authenticated', 'public._ingest_customer_row(uuid, uuid, text, text, text, text, text, text, date, timestamptz, text)', 'EXECUTE'), 'authenticated _ingest_customer_row çağıramaz');
select ok(not has_function_privilege('service_role', 'public._ingest_customer_row(uuid, uuid, text, text, text, text, text, text, date, timestamptz, text)', 'EXECUTE'), 'service_role _ingest_customer_row çağıramaz');

select ok(not has_function_privilege('anon', 'public._call_meta_sync()', 'EXECUTE'), 'anon _call_meta_sync çağıramaz');
select ok(not has_function_privilege('authenticated', 'public._call_meta_sync()', 'EXECUTE'), 'authenticated _call_meta_sync çağıramaz');
select ok(not has_function_privilege('service_role', 'public._call_meta_sync()', 'EXECUTE'), 'service_role _call_meta_sync çağıramaz');
select is((select schedule || ' ' || command from cron.job where jobname = 'telefoncu-meta-sync'),
          '*/10 * * * * select public._call_meta_sync()', 'telefoncu-meta-sync işi 10 dakikada bir');

-- ---------------------------------------------------------------------------
-- Yönetici dışı ret
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.meta_status()$$, '42501', 'Bu işlem için yönetici olmalısınız.', 'ajan meta_status çağıramaz');
select throws_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e1', '1234567890')$$, '42501', null, 'ajan meta_connect_for çağıramaz');
reset role;

-- ---------------------------------------------------------------------------
-- Yönetici: bağlantı
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is(public.meta_status(), '{"connected": false}'::jsonb, 'bağlantı yokken connected false');
select throws_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e1', '1234567890')$$, '42501', null, 'yönetici de meta_connect_for çağıramaz');
reset role;
set local role service_role;
select throws_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e1', '12ab34')$$, '22023',
                 'Sayfa kimliği geçersiz. Yalnız rakamlardan oluşmalı.', 'rakam dışı sayfa kimliği reddedilir');
select throws_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e1', '  ')$$, '22023',
                 'Sayfa kimliği geçersiz. Yalnız rakamlardan oluşmalı.', 'boş sayfa kimliği reddedilir');
select lives_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e1', ' 111222333 ')$$, 'service_role sayfayı bağlar');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.meta_status() ->> 'connected')::boolean || '|' || (public.meta_status() ->> 'page_id')),
          'true|111222333', 'meta_status bağlı ve sayfa kimliği döner');
select is((select count(*)::int from public.meta_connections), 1, 'yönetici kendi bağlantısını görür');
select throws_ok($$select count(*) from public.meta_leads$$, '42501', null, 'yönetici meta_leads tablosunu doğrudan okuyamaz');
reset role;

-- ajan bağlantı satırını göremez
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.meta_connections), 0, 'ajan meta_connections satırı görmez');
reset role;

-- kiracı 2: aynı sayfa başka hesaba bağlanamaz; kendi sayfasını bağlar; kiracı 1'i görmez
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.meta_connections), 0, 'kiracı 2 kiracı 1 bağlantısını görmez');
reset role;
set local role service_role;
select throws_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e2', '111222333')$$, '23505', 'Bu sayfa başka bir hesaba bağlı.', 'başka kiracının sayfası bağlanamaz');
select lives_ok($$select public.meta_connect_for('10000000-0000-4000-8000-0000000000e2', '444555666')$$, 'kiracı 2 kendi sayfasını bağlar');
reset role;

-- ---------------------------------------------------------------------------
-- service_role: sayfa eşleme, liste, başvuru alma
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.meta_tenant_for_page('111222333'), '10000000-0000-4000-8000-0000000000e1'::uuid, 'sayfa kiracıya eşlenir');
select is(public.meta_tenant_for_page('999999999'), null::uuid, 'bilinmeyen sayfa null');
select is((select count(*)::int from public.meta_connections_list()
           where tenant_id in ('10000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e2')),
          2, 'meta_connections_list bağlı kiracıları listeler');

-- yeni başvuru
create temp table ml_r1 on commit drop as
select public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-1', 'F-1',
  '2026-10-06 10:00+03', 'Kurgu Yeni', 'p:+905327770010', 'soru: cevap', 'Meta formu A') as r;
select is((select r ->> 'result' from ml_r1), 'inserted', 'yeni başvuru inserted');
select is((select source || '|' || source_detail || '|' || last_note from public.customers where phone = '05327770010'),
          'meta_api|Meta formu A|soru: cevap', 'kaynak meta_api, form adı ve not yazıldı');
select is((select applied_at from public.customers where phone = '05327770010'),
          '2026-10-06 10:00+03'::timestamptz, 'applied_at = created_time');
select is((select (r ->> 'customer_id')::uuid from ml_r1),
          (select id from public.customers where phone = '05327770010'), 'customer_id döner');

-- operatör sorusu Operatör alanına yazılır
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-OP', 'F-1',
  now() - interval '1 hour', 'Kurgu Operatör', '05327770077', 'tutar: 50-100', 'Meta formu A', 'turkcell') ->> 'result', 'inserted', 'operatörlü başvuru inserted');
select is((select operator || '|' || last_note from public.customers where phone = '05327770077'),
          'TC|tutar: 50-100', 'operatör normalize edilip müşteriye yazıldı');

-- idempotens
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-1', 'F-1',
  '2026-10-06 10:00+03', 'Kurgu Yeni', '05327770010', null, 'Meta formu A'), '{"result": "seen"}'::jsonb, 'aynı başvuru ikinci kez seen');
select is((select count(*)::int from public.meta_leads where tenant_id = '10000000-0000-4000-8000-0000000000e1' and leadgen_id = 'LG-1'),
          1, 'meta_leads tek satır');

-- açık kayıt: mükerrer
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-2', 'F-1',
  now() - interval '1 hour', 'Kurgu Açık', '0532 777 00 01', null, 'Meta formu A') ->> 'result', 'duplicate', 'açık kayıt duplicate');

-- kapanmış kayıt + yeni form: yeniden açılır
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-3', 'F-1',
  now() - interval '1 hour', 'Kurgu Kapalı', '05327770002', null, 'Meta formu B') ->> 'result', 'reopened', 'kapanmış kayıt reopened');
select is((select call_status || '|' || coalesce(pipeline_stage, '-') || '|' || source_detail from public.customers where phone = '05327770002'),
          'pending|-|Meta formu B', 'yeniden açılan kayıt pending, form adı güncellendi');
select ok(exists (select 1 from public.audit_log where action = 'customer_reopen' and member_id is null
                  and tenant_id = '10000000-0000-4000-8000-0000000000e1'), 'yeniden açma audit üyesiz yazılır');

-- geçersiz telefon
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e1', 'LG-4', 'F-1',
  now(), 'Kurgu Geçersiz', '12345', null, null), '{"result": "invalid", "customer_id": null}'::jsonb, 'geçersiz telefon invalid');
select is((select string_agg(leadgen_id || ':' || result, ',' order by leadgen_id) from public.meta_leads
           where tenant_id = '10000000-0000-4000-8000-0000000000e1'),
          'LG-1:inserted,LG-2:duplicate,LG-3:reopened,LG-4:invalid,LG-OP:inserted', 'meta_leads sonuçları');
select ok(not exists (select 1 from public.audit_log where action = 'meta_lead' and data::text ~ '0532777'),
          'audit kaydında telefon yok');
select isnt((select last_lead_at from public.meta_connections where tenant_id = '10000000-0000-4000-8000-0000000000e1'),
            null, 'last_lead_at güncellendi');

-- kiracı izolasyonu: aynı telefon kiracı 2'de ayrı kayıt
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e2', 'LG-1', 'F-9',
  now(), 'Kurgu Başka', '05327770010', null, null) ->> 'result', 'inserted', 'aynı leadgen/telefon diğer kiracıda ayrı eklenir');
select throws_ok($$select public.ingest_meta_lead('10000000-0000-4000-8000-0000000000e3', 'LG-X', null, now(), 'X', '05327770099', null, null)$$,
                 '22023', 'Meta bağlantısı bulunamadı.', 'bağlantısız kiracıya başvuru eklenmez');

-- meta_record_status
select public.meta_record_status('10000000-0000-4000-8000-0000000000e1', false, repeat('h', 400));
select is((select length(last_error) || '|' || (last_error_at is not null) from public.meta_connections
           where tenant_id = '10000000-0000-4000-8000-0000000000e1'), '300|true', 'hata 300 karakterle kaydedilir');
select public.meta_record_status('10000000-0000-4000-8000-0000000000e1', true, null, true);
select is((select coalesce(last_error, '-') || '|' || (last_sync_at is not null) from public.meta_connections
           where tenant_id = '10000000-0000-4000-8000-0000000000e1'), '-|true', 'başarıda hata temizlenir, tarama zamanı yazılır');
reset role;

select * from finish();
rollback;
