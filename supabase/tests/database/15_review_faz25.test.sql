-- Faz 2.5 inceleme düzeltmeleri (migration 20261004001300_review_faz25.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'rf-mgr@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000e1', 'Düzeltme Kiracı 1'),
  ('10000000-0000-4000-8000-0000000000e2', 'Düzeltme Kiracı 2');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Düzeltme Yönetici', 'manager', '{}');

-- D4: logo_url kısıtı (postgres olarak; tenant_settings satırı tenants tetikleyicisiyle oluşmayabilir, varsa güncelle)
insert into public.tenant_settings (tenant_id) values ('10000000-0000-4000-8000-0000000000e1') on conflict (tenant_id) do nothing;
select lives_ok($$update public.tenant_settings set logo_url = 'https://cdn.demo.test/a.png' where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$, 'https logo kabul');
select lives_ok($$update public.tenant_settings set logo_url = 'http://127.0.0.1:54321/storage/v1/object/public/brand-logos/x.png' where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$, 'yerel http logo kabul');
select throws_ok($$update public.tenant_settings set logo_url = 'http://evil.test/a.png' where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'harici http logo reddedilir');
select throws_ok($$update public.tenant_settings set logo_url = 'http://127.0.0.1@evil.test/a.png' where tenant_id = '10000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'userinfo kaçamağı reddedilir');

-- D6: dosya adı sözleşmesi
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/logo-0a1b2c3d-1111-4222-8333-444455556666.png')$$, 'uyan ad (png) kabul');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/logo-0a1b2c3d-1111-4222-8333-444455556667.webp')$$, 'uyan ad (webp) kabul');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/poly.html')$$, '42501', null, 'desene uymayan ad reddedilir');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/logo-0a1b2c3d-1111-4222-8333-444455556668.PNG')$$, '42501', null, 'büyük harf uzantı reddedilir');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/logo-0a1b2c3d-1111-4222-8333-444455556669.html')$$, '42501', null, 'uzantı png/jpg/webp dışı reddedilir');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e1/alt/logo-0a1b2c3d-1111-4222-8333-444455556670.png')$$, '42501', null, 'ek yol seviyesi reddedilir');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('brand-logos', '10000000-0000-4000-8000-0000000000e2/logo-0a1b2c3d-1111-4222-8333-444455556671.png')$$, '42501', null, 'desene uysa da başka kiracı yolu reddedilir');

select * from finish();
rollback;
