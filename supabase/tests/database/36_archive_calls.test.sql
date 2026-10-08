-- Geçmiş dönem müşteri aramaları (migration 20261008000300_archive_calls.sql ve 20261008000400_archive_pool_cycle.sql)
-- Senaryo tek DO bloğunda; herhangi bir assert düşerse test başarısız olur.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select lives_ok($t$
do $$
declare
  t uuid := '10000000-0000-4000-8000-0000000000d1';
  ua uuid := '20000000-0000-4000-8000-0000000000d1';
  ub uuid := '20000000-0000-4000-8000-0000000000d2';
  um uuid := '20000000-0000-4000-8000-0000000000d3';
  ma uuid := '30000000-0000-4000-8000-0000000000d1';
  mb uuid := '30000000-0000-4000-8000-0000000000d2';
  mm uuid := '30000000-0000-4000-8000-0000000000d3';
  c1 uuid := '40000000-0000-4000-8000-0000000000d1';
  c2 uuid := '40000000-0000-4000-8000-0000000000d2';
  c3 uuid := '40000000-0000-4000-8000-0000000000d3';
  c4 uuid := '40000000-0000-4000-8000-0000000000d4';
  c5 uuid := '40000000-0000-4000-8000-0000000000d5';
  r jsonb;
  cu public.customers;
  n int;
  rep jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', ua, 'authenticated', 'authenticated', 'ar-a@test.test'),
    ('00000000-0000-0000-0000-000000000000', ub, 'authenticated', 'authenticated', 'ar-b@test.test'),
    ('00000000-0000-0000-0000-000000000000', um, 'authenticated', 'authenticated', 'ar-m@test.test');
  insert into public.tenants (id, name) values (t, 'Arsiv Kurgu');
  insert into public.members (id, tenant_id, user_id, full_name, role, permissions) values
    (ma, t, ua, 'Ayse Kurgu', 'agent', '{}'), (mb, t, ub, 'Berk Kurgu', 'agent', '{}'), (mm, t, um, 'Mert Kurgu', 'manager', '{}');
  insert into public.customers (id, tenant_id, full_name, phone, call_status, pipeline_stage, last_outcome, last_note, updated_at, next_call_at) values
    (c1, t, 'Kurgu Bir', '05321600001', 'disqualified', null, 'disqualified', 'icra var', now() - interval '5 days', now() - interval '5 days'),
    (c2, t, 'Kurgu Iki', '05321600002', 'done', 'not_interested', 'not_interested', 'ilgisiz', now() - interval '40 days', now() - interval '40 days'),
    (c3, t, 'Kurgu Uc', '05321600003', 'disqualified', null, 'disqualified', null, now(), now()),
    (c4, t, 'Kurgu Dort', '05321600004', 'done', 'completed', 'appointment', null, now() - interval '40 days', now() - interval '40 days'),
    (c5, t, 'Kurgu Bes', '05321600005', 'pending', null, null, null, now() - interval '2 days', now() - interval '2 days');

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  r := public.archive_list();
  assert (r ->> 'total')::int = 2, 'liste: sadece kapali ve 1 gunden eski 2 musteri (gercek: ' || (r ->> 'total') || ')';
  assert (public.archive_list(p_q => 'icra') ->> 'total')::int = 1, 'not aramasi';
  assert (public.archive_list(p_outcome => 'not_interested') ->> 'total')::int = 1, 'sonuc filtresi';
  assert (public.archive_list(p_from => current_date - 10) ->> 'total')::int = 1, 'tarih filtresi (son 10 gun)';
  assert (r -> 'rows' -> 0 ->> 'phone') like '05321600%', 'telefon tam gorunur';
  assert (public.archive_list(p_q => '05321600002') ->> 'total')::int = 1, 'telefonla arama';
  assert (public.archive_list(p_q => '123') ->> 'total')::int = 0, 'kisa rakam telefon aramasi yapmaz';

  r := public.claim_archive_customers(array[c1, c2]);
  assert (r ->> 'claimed')::int = 2 and (r ->> 'skipped')::int = 0, 'alma: 2 musteri';
  select * into cu from public.customers where id = c1;
  assert cu.call_status = 'pending' and cu.revive_active and cu.assigned_to = ma and cu.pipeline_stage is null, 'alinan musteri bekleyen ve isaretli';
  select count(*) into n from public.daily_assignments where customer_id = c1 and member_id = ma and day = public.tr_today();
  assert n = 1, 'bugunku listede';
  select count(*) into n from public.audit_log where action = 'archive_claim' and tenant_id = t;
  assert n = 2, 'audit kaydi';

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  r := public.claim_archive_customers(array[c1]);
  assert (r ->> 'claimed')::int = 0 and (r ->> 'skipped')::int = 1, 'baska calisan alamaz';
  assert (public.archive_list() ->> 'total')::int = 0, 'alinanlar listeden cikar';

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform public.log_call(c1, 'no_answer');
  assert (select archive from public.call_attempts where customer_id = c1 order by created_at desc limit 1), 'arama arsiv bayrakli';
  perform public.log_call(c1, 'busy');
  perform public.log_call(c1, 'no_answer');
  assert (select call_status from public.customers where id = c1) = 'pool', '3 basarisiz denemeden sonra havuza duser';
  assert (select pool_count from public.customers where id = c1) = 1, 'normal dongu: havuz sayaci 0 dan baslar';
  assert (select revive_active from public.customers where id = c1), 'havuzdayken de eski musteri isaretli';
  -- havuz suresi dolunca normal dongude geri doner ve isaret kalir
  update public.customers set next_call_at = now() - interval '1 hour', call_status = 'retry' where id = c1;
  perform public.log_call(c1, 'no_answer');
  assert (select archive from public.call_attempts where customer_id = c1 order by created_at desc limit 1), 'havuzdan donen musteri aramasi da arsiv bayrakli';

  -- yeniden kapanan isaretli musteri tekrar listelenir
  perform public.log_call(c2, 'not_interested');
  alter table public.customers disable trigger customers_before_write;
  update public.customers set updated_at = now() - interval '2 days' where id = c2;
  alter table public.customers enable trigger customers_before_write;
  assert (select revive_active from public.customers where id = c2), 'kapaninca da isaret kalir';
  assert (public.archive_list(p_q => 'Kurgu Iki') ->> 'total')::int = 1, 'yeniden kapanan eski musteri tekrar listelenir';

  insert into public.daily_assignments (tenant_id, day, customer_id, member_id, position) values (t, public.tr_today(), c5, ma, 99);
  update public.customers set assigned_to = ma where id = c5;
  perform public.log_call(c5, 'no_answer');
  assert not (select archive from public.call_attempts where customer_id = c5 limit 1), 'normal arama bayraksiz';

  update public.customers set applied_at = now() where id = c2;
  assert not (select revive_active from public.customers where id = c2), 'yeni form: normal musteriye doner';

  perform set_config('request.jwt.claims', json_build_object('sub', um, 'role', 'authenticated')::text, true);
  rep := public.report_intake(current_date - 1, current_date);
  assert (rep ->> 'waiting_now')::int = 0, 'waiting_now gecmis donem musterisini saymaz (gercek: ' || (rep ->> 'waiting_now') || ')';

  rep := public._report_range(t, null, current_date - 1, current_date);
  assert (rep -> 'archive' ->> 'claimed')::int = 2, 'rapor: alinan 2';
  assert (rep -> 'archive' ->> 'attempts')::int = 5, 'rapor: arsiv arama 5';
  assert (rep -> 'totals' ->> 'attempts')::int = 6, 'toplam sayac arsivi de icerir (5+1)';
  assert (rep -> 'archive' -> 'by_member' -> 0 ->> 'attempts')::int = 5, 'calisan kirilimi';
  assert (select coalesce(sum((x ->> 'customers')::int), 0) from jsonb_array_elements(rep -> 'by_source') x) = 1, 'kaynak performansi yalniz normal arama (1 musteri)';

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  insert into public.customers (id, tenant_id, full_name, phone, call_status, last_outcome, updated_at, next_call_at)
  select gen_random_uuid(), t, 'Kurgu Toplu ' || g, '0532170' || lpad(g::text, 4, '0'), 'disqualified', 'disqualified', now() - interval '3 days', now() - interval '3 days'
  from generate_series(1, 12) g;
  begin
    perform public.claim_archive_customers((select array_agg(id) from (select id from public.customers where full_name like 'Kurgu Toplu%' limit 11) q));
    assert false, '11 musteri tek seferde alinabildi';
  exception when sqlstate '22023' then null; end;
  r := public.claim_archive_customers((select array_agg(id) from (select id from public.customers where full_name like 'Kurgu Toplu%' order by full_name limit 10) q));
  assert (r ->> 'claimed')::int = 10, '10 musteri alinir';
  begin
    perform public.claim_archive_customers((select array_agg(id) from (select id from public.customers where full_name like 'Kurgu Toplu%' and not revive_active limit 1) q));
    assert false, '11. bekleyen alinabildi';
  exception when sqlstate '22023' then null; end;
end $$;
$t$, 'geçmiş dönem: liste, alma, havuz döngüsü, bayrak, rapor ve sınır kuralları');

select * from finish();
rollback;
