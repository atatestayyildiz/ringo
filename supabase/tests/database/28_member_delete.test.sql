-- Kullanıcı silme (migration 20261005001700_member_delete.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'md-yonetici@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'md-ajan@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated', 'md-ajan2@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f4', 'authenticated', 'authenticated', 'md-baska@test.test');
insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-0000000000f1', 'Silme Kiracı'),
  ('10000000-0000-4000-8000-0000000000f2', 'Başka Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions, is_active) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Yasemin Yönetici', 'manager', '{}', true),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Arda Ajan', 'agent', '{}', false),
  ('30000000-0000-4000-8000-0000000000f3', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f3', 'Aktif Ajan', 'agent', '{}', true),
  ('30000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f4', 'Başka Yönetici', 'manager', '{}', true);
insert into public.customers (id, tenant_id, full_name, phone, assigned_to, call_status) values
  ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Kurgu Müşteri', '05325550901', '30000000-0000-4000-8000-0000000000f2', 'done');
insert into public.call_attempts (tenant_id, customer_id, member_id, outcome) values
  ('10000000-0000-4000-8000-0000000000f1', '40000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f2', 'no_answer');

select ok(not has_function_privilege('anon', 'public.anonymize_member(uuid)', 'EXECUTE'), 'anon anonymize_member çağıramaz');
select ok(has_function_privilege('authenticated', 'public.anonymize_member(uuid)', 'EXECUTE'), 'authenticated çağırabilir');

-- Yetki: çalışan silemez
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f2')$$, '42501', null, 'çalışan üye silemez');
reset role;

-- Yönetici
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f1')$$, '22023', null, 'yönetici kendini silemez');
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f3')$$, '22023', null, 'aktif üye silinemez, önce pasifleştirilir');
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f4')$$, '22023', null, 'başka kiracının üyesi bulunamaz');
reset role;

-- Açık müşterisi olan silinemez
update public.customers set call_status = 'pending' where id = '40000000-0000-4000-8000-0000000000f1';
set local role authenticated;
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f2')$$, '22023', null, 'açık müşterisi olan silinemez');
reset role;
update public.customers set call_status = 'done' where id = '40000000-0000-4000-8000-0000000000f1';

set local role authenticated;
select is(public.anonymize_member('30000000-0000-4000-8000-0000000000f2'), '20000000-0000-4000-8000-0000000000f2'::uuid, 'silme giriş hesabı kimliğini döndürür');
reset role;
select is((select full_name from public.members where id = '30000000-0000-4000-8000-0000000000f2'), 'Silinmiş kullanıcı', 'ad anonimleşti');
select ok(exists (select 1 from public.audit_log where action = 'member_deleted' and entity_id = '30000000-0000-4000-8000-0000000000f2'), 'silme audit kaydına yazıldı');

-- Giriş hesabı silinince üyelik satırı ve geçmiş korunur
delete from auth.users where id = '20000000-0000-4000-8000-0000000000f2';
select is((select user_id from public.members where id = '30000000-0000-4000-8000-0000000000f2'), null::uuid, 'hesap silinince user_id boşalır');
select is((select count(*)::int from public.call_attempts where member_id = '30000000-0000-4000-8000-0000000000f2'), 1, 'arama geçmişi korunur');

set local role authenticated;
select throws_ok($$select public.anonymize_member('30000000-0000-4000-8000-0000000000f2')$$, '22023', null, 'zaten silinmiş üye tekrar silinemez');
reset role;

select * from finish();
rollback;
