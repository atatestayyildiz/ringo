begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ro-mgr@test.test');
insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000a1', 'Test Kiracı RO');
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Yönetici RO', 'manager', '{}');

-- Kapanmış müşteriler; updated_at 5 ay önce
insert into public.customers (tenant_id, full_name, phone, call_status, pipeline_stage, assigned_to, pool_count, last_note, appointment_day, updated_at)
select '10000000-0000-4000-8000-0000000000a1', v.n, v.p, v.st, v.stage, v.mem, v.pc, v.note, v.ad, now() - interval '150 days'
from (values
  ('Kapanmış Bir',      '05321110001', 'done',        'completed',   '30000000-0000-4000-8000-0000000000a1'::uuid, 2, 'eski', null::date),
  ('Ulaşılamadı',       '05321110002', 'unreachable', null,          null::uuid, 3, null, null),
  ('Kapanmış Tarihsiz', '05321110003', 'done',        'completed',   null, 0, null, null),
  ('Aktif Aranacak',    '05321110004', 'retry',       null,          null, 0, null, null),
  ('Randevulu',         '05321110005', 'done',        'appointment', null, 0, null, public.tr_today() + 3),
  ('Eski Form',         '05321110006', 'done',        'completed',   null, 0, null, null)
) as v(n, p, st, stage, mem, pc, note, ad);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

create temporary table ro_result on commit drop as
select public.import_customers(format($j$[
  {"full_name": "Kapanmış Bir", "phone": "0532 111 00 01", "applied_at": "%1$s", "note": "yeni form", "operator": "TT"},
  {"full_name": "Ulaşılamadı", "phone": "05321110002", "applied_at": "%1$s"},
  {"full_name": "Kapanmış Tarihsiz", "phone": "05321110003"},
  {"full_name": "Aktif Aranacak", "phone": "05321110004", "applied_at": "%1$s"},
  {"full_name": "Randevulu", "phone": "05321110005", "applied_at": "%1$s"},
  {"full_name": "Eski Form", "phone": "05321110006", "applied_at": "%2$s"},
  {"full_name": "Kapanmış Bir", "phone": "05321110001", "applied_at": "%1$s"}
]$j$, (now() - interval '1 day')::text, (now() - interval '200 days')::text)::jsonb, 'Yeni Meta formu') as r;

select is((select (r ->> 'reopened')::int from ro_result), 2, 'kapanmış iki müşteri yeniden açıldı');
select is((select (r ->> 'duplicates')::int from ro_result), 5, 'tarihsiz, aktif, randevulu, eski form ve dosya içi tekrar mükerrer');
select is((select (r ->> 'inserted')::int from ro_result), 0, 'yeni kayıt eklenmedi');

select is((select call_status || '|' || coalesce(pipeline_stage, '-') || '|' || pool_count || '|' || coalesce(assigned_to::text, '-')
           from public.customers where phone = '05321110001'),
          'pending|-|0|-', 'durum sıfırlandı: pending, aşama boş, havuz sayacı 0, atama boş');
select is((select last_note from public.customers where phone = '05321110001'), 'Tekrar başvurdu · yeni form', 'not tekrar başvuru olarak yazıldı');
select is((select source_detail from public.customers where phone = '05321110001'), 'Yeni Meta formu', 'kaynak yeni form adıyla güncellendi');
select is((select call_status from public.customers where phone = '05321110002'), 'pending', 'ulaşılamayan müşteri yeniden açıldı');
select is((select call_status from public.customers where phone = '05321110003'), 'done', 'başvuru tarihsiz satır mükerrer, kapalı kaldı');
select is((select call_status from public.customers where phone = '05321110004'), 'retry', 'zaten aranacak müşteriye dokunulmadı');
select is((select call_status from public.customers where phone = '05321110005'), 'done', 'ileri tarihli randevusu olan müşteri yeniden açılmadı');
select is((select call_status from public.customers where phone = '05321110006'), 'done', 'son işlemden önceki tarihli form yeniden açmaz');

-- Aynı dosyayı ikinci kez yüklemek ek açma yapmaz
select is((select (public.import_customers(format('[{"full_name":"Kapanmış Bir","phone":"05321110001","applied_at":"%s"}]',
          (now() - interval '1 day')::text)::jsonb, 'Yeni Meta formu') ->> 'reopened')::int), 0, 'aynı dosya ikinci yüklemede tekrar açmaz');
reset role;

select * from finish();
rollback;
