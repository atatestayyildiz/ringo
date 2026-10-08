-- Meta başvuru durum geribeslemesi: olay kuyruğu tetikleyicileri (migration 20261008000500_meta_feedback.sql)
-- Senaryo tek DO bloğunda; herhangi bir assert düşerse test başarısız olur.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select lives_ok($t$
do $$
declare
  t uuid := '10000000-0000-4000-8000-0000000000e1';
  c1 uuid := '40000000-0000-4000-8000-0000000000e1';
  c2 uuid := '40000000-0000-4000-8000-0000000000e2';
  c3 uuid := '40000000-0000-4000-8000-0000000000e3';
  c4 uuid := '40000000-0000-4000-8000-0000000000e4';
  n int;
begin
  insert into public.tenants (id, name) values (t, 'Geri Bildirim Kurgu');
  insert into public.customers (id, tenant_id, full_name, phone, call_status) values
    (c1, t, 'Kurgu Bir', '05321700001', 'pending'),
    (c2, t, 'Kurgu Iki', '05321700002', 'pending'),
    (c3, t, 'Kurgu Uc', '05321700003', 'pending'),
    (c4, t, 'Kurgu Dort', '05321700004', 'pending');
  update public.customers set revive_active = true where id = c4;

  -- ingest akisi: once invalid, sonra sonuc guncellenir
  insert into public.meta_leads (tenant_id, leadgen_id, form_id, created_time, result) values
    (t, '111111111111111', 'f1', now() - interval '1 hour', 'invalid'),
    (t, '222222222222222', 'f1', now() - interval '1 hour', 'invalid'),
    (t, '444444444444444', 'f1', now() - interval '1 hour', 'invalid');
  update public.meta_leads set result = 'inserted', customer_id = c1 where leadgen_id = '111111111111111';
  update public.meta_leads set result = 'inserted', customer_id = c2 where leadgen_id = '222222222222222';
  update public.meta_leads set result = 'inserted', customer_id = c4 where leadgen_id = '444444444444444';

  select count(*) into n from public.meta_feedback_events where tenant_id = t and signal = 'lead';
  assert n = 3, 'her yeni Meta basvurusu icin lead olayi (gercek: ' || n || ')';

  -- durum degisimleri
  update public.customers set call_status = 'retry' where id = c1;
  select count(*) into n from public.meta_feedback_events where tenant_id = t and leadgen_id = '111111111111111';
  assert n = 1, 'retry sinyal uretmez';

  update public.customers set call_status = 'done', pipeline_stage = 'appointment' where id = c1;
  assert exists (select 1 from public.meta_feedback_events where leadgen_id = '111111111111111' and signal = 'appointment' and status = 'pending'), 'randevu sinyali';

  update public.customers set pipeline_stage = 'completed' where id = c1;
  assert exists (select 1 from public.meta_feedback_events where leadgen_id = '111111111111111' and signal = 'completed'), 'islem tamam sinyali';

  update public.customers set pipeline_stage = 'appointment' where id = c1;
  select count(*) into n from public.meta_feedback_events where leadgen_id = '111111111111111' and signal = 'appointment';
  assert n = 1, 'ayni sinyal ikinci kez kuyruga girmez';

  update public.customers set call_status = 'disqualified' where id = c2;
  assert exists (select 1 from public.meta_feedback_events where leadgen_id = '222222222222222' and signal = 'disqualified'), 'uygun degil sinyali';

  -- Meta basvurusu olmayan musteri ve gecmis donem musterisi
  update public.customers set call_status = 'disqualified' where id = c3;
  select count(*) into n from public.meta_feedback_events where customer_id = c3;
  assert n = 0, 'Meta basvurusu olmayan musteri olay uretmez';
  update public.customers set call_status = 'disqualified' where id = c4;
  select count(*) into n from public.meta_feedback_events where customer_id = c4 and signal <> 'lead';
  assert n = 0, 'gecmis donem musterisinin durum olayi gonderilmez';

  -- geri donen musteri: yeni basvuru yeni lead_id ile Giris, sonraki sinyaller yeni basvuruya yazilir
  insert into public.meta_leads (tenant_id, leadgen_id, form_id, created_time, result, received_at)
    values (t, '555555555555555', 'f1', now(), 'invalid', now() + interval '1 minute');
  update public.meta_leads set result = 'reopened', customer_id = c2 where leadgen_id = '555555555555555';
  assert exists (select 1 from public.meta_feedback_events where leadgen_id = '555555555555555' and signal = 'lead'), 'geri donen musteri: yeni lead olayi';
  update public.customers set call_status = 'pending', pipeline_stage = null where id = c2;
  update public.customers set pipeline_stage = 'appointment', call_status = 'done' where id = c2;
  assert exists (select 1 from public.meta_feedback_events where leadgen_id = '555555555555555' and signal = 'appointment'), 'sonraki sinyal en yeni basvuruya yazilir';

  -- istemci rolleri kuyruga erisemez
  assert not has_table_privilege('authenticated', 'public.meta_feedback_events', 'select'), 'authenticated okuyamaz';
  assert not has_table_privilege('anon', 'public.meta_feedback_events', 'select'), 'anon okuyamaz';
end $$;
$t$, 'meta geri bildirim: lead ve durum sinyalleri, tekrar, geri dönen müşteri, erişim');

select * from finish();
rollback;
