begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ic-mgr@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ic-a1@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ic-a2@test.test');

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-000000000001', 'Test Kiracı 1');

insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Yönetici Bir', 'manager', '{}'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'A Ajan', 'agent', '{}'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'B Ajan', 'agent', '{"import_customers": true}');

insert into public.customers (tenant_id, full_name, phone)
values ('10000000-0000-4000-8000-000000000001', 'Mevcut Kişi', '05324440001');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

create temporary table import_result on commit drop as
select public.import_customers($j$[
  {"full_name": "Kurgu Bir", "phone": "+90 532 444 00 11", "operator": "Vodafone", "birth_date": "1990-05-05", "note": "formdan"},
  {"full_name": "Kurgu İki", "phone": "5324440012", "operator": "TT"},
  {"full_name": "Kurgu Üç", "phone": "12345"},
  {"full_name": "  ", "phone": "05324440013"},
  {"full_name": "Kurgu Dört", "phone": "0532 444 00 11"},
  {"full_name": "Mevcut Kopya", "phone": "0532-444-00-01"},
  {"full_name": "Kurgu Beş", "phone": "05324440015", "birth_date": "tarih değil", "applied_at": "2026-10-01 09:30"}
]$j$::jsonb, 'Meta form (test).xlsx') as r;

select is((select (r ->> 'inserted')::int from import_result), 3, '3 satır eklendi');
select is((select (r ->> 'duplicates')::int from import_result), 2, '2 mükerrer (dosya içi + mevcut)');
select is((select (r ->> 'invalid')::int from import_result), 2, '2 geçersiz');
select is((select r -> 'invalid_rows' from import_result),
          '[{"index": 2, "reason": "Telefon numarası geçersiz"}, {"index": 3, "reason": "Ad soyad boş"}]'::jsonb,
          'invalid_rows sıra ve neden içerir');
select is((select operator from public.customers where phone = '05324440011'), 'VF', 'telefon normalize, operatör eşlendi');
select is((select source || '|' || source_detail from public.customers where phone = '05324440011'),
          'import|Meta form (test).xlsx', 'kaynak ve dosya adı yazıldı');
select is((select last_note from public.customers where phone = '05324440011'), 'formdan', 'not last_note olarak yazıldı');
select is((select full_name from public.customers where phone = '05324440001'), 'Mevcut Kişi', 'mevcut kayıt değişmedi');
select is((select birth_date from public.customers where phone = '05324440015'), null, 'hatalı doğum tarihi boş geçildi');
select is((select applied_at from public.customers where phone = '05324440015'),
          '2026-10-01 09:30:00+03'::timestamptz, 'başvuru zamanı İstanbul saatiyle okundu');
select ok(exists(select 1 from public.audit_log where action = 'import_customers'), 'içe aktarma audit_log yazar');
select throws_ok($$select public.import_customers('{"a":1}'::jsonb, 'x')$$, '22023',
                 'İçe aktarılacak satırlar liste biçiminde olmalı.', 'dizi olmayan girdi reddedilir');
reset role;

-- yetkisiz ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.import_customers('[]'::jsonb, 'x')$$, '42501',
                 'Müşteri içe aktarma yetkiniz yok.', 'import_customers yetkisi olmayan ajan içe aktaramaz');
reset role;

-- yetkili ajan
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select (public.import_customers('[{"full_name":"Ajan Ekledi","phone":"05324440020"}]'::jsonb, 'elle') ->> 'inserted')::int),
          1, 'import_customers yetkili ajan içe aktarır');
reset role;
select is((select tenant_id from public.customers where phone = '05324440020'),
          '10000000-0000-4000-8000-000000000001'::uuid, 'eklenen müşteri çağıranın kiracısında');

select * from finish();
rollback;
