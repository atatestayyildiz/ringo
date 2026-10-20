-- Meta telefon yedeği (migration 20261020000100_meta_phone_fallback.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.tenants (id, name) values ('10000000-0000-4000-8000-0000000000f1', 'Test Kiracı TY');
insert into public.meta_connections (tenant_id, page_id) values ('10000000-0000-4000-8000-0000000000f1', '900000000000001');

-- yetki
select ok(not has_function_privilege('authenticated', 'public._meta_salvage_phone(text)', 'EXECUTE'), 'authenticated _meta_salvage_phone çağıramaz');
select ok(not has_function_privilege('anon', 'public._meta_salvage_phone(text)', 'EXECUTE'), 'anon _meta_salvage_phone çağıramaz');

-- kurtarma kuralı dar
select is(public._meta_salvage_phone('+15327771001'), '05327771001', '+1 ülke kodu kurtarılır');
select is(public._meta_salvage_phone('+495327771002'), '05327771002', '+49 ülke kodu kurtarılır');
select is(public._meta_salvage_phone('+9053277710031'), null, '+90 fazla haneli numara kurtarılmaz');
select is(public._meta_salvage_phone('053277710041'), null, '0 ile başlayan fazla haneli numara kurtarılmaz');

-- ana telefon geçersiz, ikinci geçerli: yer değiştirir
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000f1', 'TY-1', 'F-1', now() - interval '1 hour',
  'Kurgu Yedek', '+1532777101', null, 'Meta formu', null, '0532 777 10 05', null) ->> 'result', 'inserted', 'ikinci telefonla eklenir');
select is((select phone || '|' || coalesce(phone_alt, '-') from public.customers where full_name = 'Kurgu Yedek'),
          '05327771005|-', 'ikinci telefon ana telefona geçer');

-- ikisi de geçersiz, ana telefon yanlış ülke koduyla: kurtarılır
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000f1', 'TY-2', 'F-1', now() - interval '1 hour',
  'Kurgu Kod', '+15327771006', null, 'Meta formu', null, '20000', '20000') ->> 'result', 'inserted', 'yanlış ülke kodlu telefon eklenir');
select is((select phone from public.customers where full_name = 'Kurgu Kod'), '05327771006', 'ülke kodu düzeltildi');

-- geçerli ana telefon: davranış aynı
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000f1', 'TY-3', 'F-1', now() - interval '1 hour',
  'Kurgu Normal', '+905327771007', null, 'Meta formu', null, '05327771008', null) ->> 'result', 'inserted', 'geçerli telefon eklenir');
select is((select phone || '|' || phone_alt from public.customers where full_name = 'Kurgu Normal'),
          '05327771007|05327771008', 'ana ve ikinci telefon yerinde');

-- önceden invalid kalmış başvuru yeniden işlenir, işlenmiş olan seen
insert into public.meta_leads (tenant_id, leadgen_id, form_id, created_time, result)
values ('10000000-0000-4000-8000-0000000000f1', 'TY-4', 'F-1', now() - interval '2 days', 'invalid');
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000f1', 'TY-4', 'F-1', now() - interval '2 days',
  'Kurgu Geri', '+495327771009', null, 'Meta formu') ->> 'result', 'inserted', 'eski invalid başvuru yeniden işlenir');
select is(public.ingest_meta_lead('10000000-0000-4000-8000-0000000000f1', 'TY-4', 'F-1', now() - interval '2 days',
  'Kurgu Geri', '+495327771009', null, 'Meta formu'), '{"result": "seen"}'::jsonb, 'işlenmiş başvuru ikinci kez seen');

select * from finish();
rollback;
