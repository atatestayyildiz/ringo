-- Yerel geliştirme seed'i (spec §10). Tüm kişi ve numaralar kurgusaldır.
-- Giriş: yonetici@demo.test, elif@demo.test, ayse@demo.test, can@demo.test
-- Şifre (yalnız yerel test değeri): Demo1234!

-- ---------------------------------------------------------------------------
-- Kiracı ve marka
-- ---------------------------------------------------------------------------
insert into public.tenants (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Demo Mağaza');

update public.tenant_settings
set brand_name = 'Demo Mağaza'
where tenant_id = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Auth kullanıcıları (GoTrue: token kolonları boş string olmalı)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Demo1234!', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'yonetici@demo.test', 'Deniz Yönetici'),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'elif@demo.test', 'Elif Demo'),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'ayse@demo.test', 'Ayşe Demo'),
  ('aaaaaaaa-0000-4000-8000-000000000004'::uuid, 'can@demo.test', 'Can Demo')
) as u(id, email, full_name);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%@demo.test';

-- ---------------------------------------------------------------------------
-- Üyeler
-- ---------------------------------------------------------------------------
insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
  ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Deniz Yönetici', 'manager', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000002', 'Elif Demo', 'agent',
   '{"import_customers": true, "view_reports": true}'),
  ('bbbbbbbb-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000003', 'Ayşe Demo', 'agent', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000004', 'Can Demo', 'agent', '{}');

-- ---------------------------------------------------------------------------
-- 40 kurgusal müşteri: telefonlar 0532 000 00 01 ... 0532 000 00 40
-- ---------------------------------------------------------------------------
with names as (
  select
    array['Ahmet','Mehmet','Zeynep','Fatma','Mustafa','Emine','Ali','Hatice','Hüseyin','Esra',
          'Burak','Merve','Emre','Selin','Oğuz','Gizem','Kerem','Derya','Serkan','Tuğba'] as first,
    array['Örnekoğlu','Denemeci','Kurgusal','Testçi','Hayalî','Uydurmaca','Misalli','Taslakçı'] as last
)
insert into public.customers (
  tenant_id, full_name, phone, operator, birth_date, source, source_detail,
  applied_at, created_at, next_call_at
)
select
  '11111111-1111-1111-1111-111111111111',
  n.first[1 + (i - 1) % 20] || ' ' || n.last[1 + (i - 1) % 8],
  '0532000' || lpad(i::text, 4, '0'),
  (array['VF','TC','TT'])[1 + i % 3],
  case when i % 4 = 0 then date '1985-01-01' + (i * 97) else null end,
  case when i <= 30 then 'import' else 'manual' end,
  case when i <= 30 then 'Meta acil nakit formu (örnek).xlsx' else null end,
  now() - make_interval(hours => 60 - i),
  now() - make_interval(hours => 60 - i),
  now() - make_interval(hours => 60 - i)
from generate_series(1, 40) as i, names n;

-- Doğum günü kartı için: biri 3 gün, biri 1 gün sonra (dağıtımdan sonra Elif'e taşınır, aşağıda)
update public.customers
set birth_date = case phone
  when '05320000005' then make_date(1992, extract(month from (now() at time zone 'Europe/Istanbul')::date + 3)::int,
                                    extract(day from (now() at time zone 'Europe/Istanbul')::date + 3)::int)
  when '05320000012' then make_date(1985, extract(month from (now() at time zone 'Europe/Istanbul')::date + 1)::int,
                                    extract(day from (now() at time zone 'Europe/Istanbul')::date + 1)::int)
end
where tenant_id = '11111111-1111-1111-1111-111111111111' and phone in ('05320000005', '05320000012');

-- ---------------------------------------------------------------------------
-- Geçmiş denemeler: tekrar aranacaklar ve havuz örnekleri
-- ---------------------------------------------------------------------------

-- 0532 000 00 01..04: dün 1-2 kez açmadı, tekrar aranacak (retry)
update public.customers c set
  call_status = 'retry',
  attempts_in_round = v.attempts,
  assigned_to = v.member,
  last_outcome = 'no_answer',
  next_call_at = now() - interval '1 day'
from (values
  ('05320000001', 1, 'bbbbbbbb-0000-4000-8000-000000000002'::uuid),
  ('05320000002', 2, 'bbbbbbbb-0000-4000-8000-000000000003'::uuid),
  ('05320000003', 1, 'bbbbbbbb-0000-4000-8000-000000000004'::uuid),
  ('05320000004', 2, 'bbbbbbbb-0000-4000-8000-000000000002'::uuid)
) as v(phone, attempts, member)
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.phone = v.phone;

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, note, created_at)
select c.tenant_id, c.id, c.assigned_to, 'no_answer', null, now() - interval '1 day' - make_interval(hours => g)
from public.customers c
cross join lateral generate_series(1, c.attempts_in_round) g
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.call_status = 'retry';

-- 0532 000 00 06..08: havuzda (3 başarısız deneme); 06 ve 07 ileride döner, 08 bugün döner
update public.customers c set
  call_status = 'pool',
  pool_count = v.pool_count,
  attempts_in_round = 0,
  assigned_to = 'bbbbbbbb-0000-4000-8000-000000000003',
  last_outcome = 'busy',
  next_call_at = public.tr_day_start((now() at time zone 'Europe/Istanbul')::date + v.days)
from (values
  ('05320000006', 1, 4),
  ('05320000007', 2, 2),
  ('05320000008', 1, 0)
) as v(phone, pool_count, days)
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.phone = v.phone;

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, created_at)
select c.tenant_id, c.id, c.assigned_to, (array['no_answer','busy','no_answer'])[g], now() - interval '3 days' - make_interval(hours => g)
from public.customers c
cross join lateral generate_series(1, 3) g
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.call_status = 'pool';

-- 0532 000 00 09: randevu alındı; 10: ilgilenmiyor; 11: uygun değil
update public.customers c set
  call_status = v.status,
  pipeline_stage = v.stage,
  assigned_to = 'bbbbbbbb-0000-4000-8000-000000000002',
  last_outcome = v.outcome,
  last_note = v.note
from (values
  ('05320000009', 'done', 'appointment', 'appointment', 'Cumartesi öğlen dükkana gelecek.'),
  ('05320000010', 'done', 'not_interested', 'not_interested', null),
  ('05320000011', 'disqualified', null, 'disqualified', 'Kredi notu düşük (örnek not).')
) as v(phone, status, stage, outcome, note)
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.phone = v.phone;

insert into public.call_attempts (tenant_id, customer_id, member_id, outcome, note, created_at)
select c.tenant_id, c.id, c.assigned_to, c.last_outcome, c.last_note, now() - interval '1 day'
from public.customers c
where c.tenant_id = '11111111-1111-1111-1111-111111111111'
  and c.phone in ('05320000009', '05320000010', '05320000011');

insert into public.pipeline_events (tenant_id, customer_id, member_id, stage, note, created_at)
select c.tenant_id, c.id, c.assigned_to, c.pipeline_stage, c.last_note, now() - interval '1 day'
from public.customers c
where c.tenant_id = '11111111-1111-1111-1111-111111111111'
  and c.phone in ('05320000009', '05320000010');

-- ---------------------------------------------------------------------------
-- Bugünün dağıtımı (arayüz geliştirme için /bugun dolu gelsin)
-- ---------------------------------------------------------------------------
select public._distribute_day_for('11111111-1111-1111-1111-111111111111',
                                  (now() at time zone 'Europe/Istanbul')::date);

-- Doğum günü müşterileri bugün Elif'in listesinde olsun (kart demoda görünsün)
update public.customers
set assigned_to = 'bbbbbbbb-0000-4000-8000-000000000002'
where tenant_id = '11111111-1111-1111-1111-111111111111' and phone in ('05320000005', '05320000012');

insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position)
select c.tenant_id, (now() at time zone 'Europe/Istanbul')::date, c.id, 'bbbbbbbb-0000-4000-8000-000000000002',
       100 + row_number() over (order by c.phone)
from public.customers c
where c.tenant_id = '11111111-1111-1111-1111-111111111111' and c.phone in ('05320000005', '05320000012')
on conflict (day, customer_id) do update set member_id = excluded.member_id;
