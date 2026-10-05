-- Marka logosu depolama (migration 20261004001200_brand_logo_storage.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'bl-mgr1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', 'bl-agt1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated', 'bl-mgr2@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000d1', 'Logo Kiracı 1'),
  ('10000000-0000-4000-8000-0000000000d2', 'Logo Kiracı 2');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', 'Logo Yönetici 1', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000d2', '10000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d2', 'Logo Ajan 1', 'agent', '{}'),
  ('30000000-0000-4000-8000-0000000000d3', '10000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000d3', 'Logo Yönetici 2', 'manager', '{}');

-- Fixture dosyaları (postgres olarak): her kiracıya bir logo
insert into storage.objects (bucket_id, name) values
  ('brand-logos', '10000000-0000-4000-8000-0000000000d1/eski.png'),
  ('brand-logos', '10000000-0000-4000-8000-0000000000d2/eski.png');

-- Bucket sözleşmesi
select is((select public from storage.buckets where id = 'brand-logos'), true, 'bucket herkese açık okunur (kamu URL)');
select is((select file_size_limit from storage.buckets where id = 'brand-logos'), 524288::bigint, 'bucket boyut sınırı 512 KB');
select is((select allowed_mime_types from storage.buckets where id = 'brand-logos'), array['image/png', 'image/jpeg', 'image/webp'], 'bucket yalnız PNG, JPEG, WebP');
select ok(not exists (select 1 from storage.buckets where id = 'brand-logos' and 'image/svg+xml' = any (allowed_mime_types)), 'SVG bucket seviyesinde yasak');

-- Yönetici 1
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000d1/logo-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png')$$, 'yönetici kendi kiracı yoluna yazar');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000d2/logo-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$$, '42501', null, 'yönetici başka kiracı yoluna yazamaz');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', 'logo-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png')$$, '42501', null, 'yönetici kök yola yazamaz');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000d1x/logo-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$$, '42501', null, 'önek tam klasör eşleşmesidir');
select throws_ok($$update storage.objects set name = '10000000-0000-4000-8000-0000000000d2/logo-dddddddd-dddd-4ddd-8ddd-dddddddddddd.png' where name = '10000000-0000-4000-8000-0000000000d1/logo-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'$$, '42501', null, 'yönetici dosyayı başka kiracıya taşıyamaz');
select is((select count(*)::int from storage.objects where bucket_id = 'brand-logos'), 2, 'yönetici yalnız kendi kiracısının dosyalarını görür');

-- Silme: storage.protect_delete SQL ile doğrudan silmeyi engeller; silme Storage API ile yapılır ve
-- bu politikalardan geçer (uçtan uca scripts/security-probe.mjs ve uygulama testinde doğrulanır).
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'brand_logos_%'), 4, 'dört logo politikası var');
select ok((select qual ~ 'auth_is_manager' and qual ~ 'auth_tenant_id' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'brand_logos_delete'), 'silme politikası yönetici ve kiracı önekiyle sınırlı');

-- Çalışan (ajan)
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000d1/ajan.png')$$, '42501', null, 'çalışan kendi kiracısına bile yazamaz');

-- Yönetici 2 diğer kiracıyı göremez
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'brand-logos' and name like '10000000-0000-4000-8000-0000000000d1/%'), 0, 'diğer kiracının yöneticisi dosyaları listeleyemez');

-- Anon
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000d1/anon.png')$$, '42501', null, 'anon yazamaz');
select is((select count(*)::int from storage.objects where bucket_id = 'brand-logos'), 0, 'anon listeleyemez (okuma yalnız kamu URL ile)');

select * from finish();
rollback;
