-- Kişisel arayüz vurgu rengi (migration 20261005000900_member_accent.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', 'acc-yonetici@test.test'),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated', 'acc-ajan@test.test');
insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000f1', 'Renk Kiracı');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 'Yasemin Yönetici', 'manager', '{}'),
  ('30000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f2', 'Arda Ajan', 'agent', '{}');

-- ACL
select ok(not has_function_privilege('anon', 'public.set_my_accent(text)', 'EXECUTE'), 'anon set_my_accent çağıramaz');
select ok(has_function_privilege('authenticated', 'public.set_my_accent(text)', 'EXECUTE'), 'authenticated set_my_accent çağırır');
select ok(not has_column_privilege('authenticated', 'public.members', 'accent_color', 'UPDATE'), 'accent_color doğrudan güncellenemez (yetki yok)');
select ok(has_column_privilege('authenticated', 'public.members', 'accent_color', 'SELECT'), 'accent_color okunabilir');

-- Ajan olarak
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000f2","role":"authenticated"}', true);
set local role authenticated;

select lives_ok($$select public.set_my_accent('#1D4ED8')$$, 'ajan kendi rengini ayarlar');
select is((select accent_color from public.members where id = '30000000-0000-4000-8000-0000000000f2'),
          '#1d4ed8', 'renk küçük harfle kaydedilir');
select throws_ok($$select public.set_my_accent('red')$$, '22023', null, 'geçersiz renk 22023');
select throws_ok($$select public.set_my_accent('#12345')$$, '22023', null, 'kısa hex 22023');
select throws_ok($$update public.members set accent_color = '#000000' where id = '30000000-0000-4000-8000-0000000000f2'$$,
                 '42501', null, 'kendi satırına doğrudan update reddedilir');
select throws_ok($$update public.members set accent_color = '#000000' where id = '30000000-0000-4000-8000-0000000000f1'$$,
                 '42501', null, 'başkasının satırına doğrudan update reddedilir');
select lives_ok($$select public.set_my_accent(null)$$, 'ajan varsayılana döner');

reset role;
select results_eq(
  $$select id::text, accent_color from public.members where tenant_id = '10000000-0000-4000-8000-0000000000f1' order by id$$,
  $$values ('30000000-0000-4000-8000-0000000000f1', null::text), ('30000000-0000-4000-8000-0000000000f2', null::text)$$,
  'sıfırlandı; yöneticinin satırı hiç değişmedi');

select * from finish();
rollback;
