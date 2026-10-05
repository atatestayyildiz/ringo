-- Bildirim zamanlayıcısı pg_cron + pg_net (migration 20261005001300_notify_via_pg_net.sql)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Test bağımsız olsun: varsa yerel sırları bu işlem içinde kaldır (rollback ile geri gelir)
delete from vault.secrets where name in ('app_url', 'cron_secret');

-- ---------------------------------------------------------------------------
-- Uzantı ve iş
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from pg_extension where extname = 'pg_net'), 'pg_net etkin');
select is(
  (select schedule from cron.job where jobname = 'telefoncu-notify'),
  '*/5 * * * *',
  'telefoncu-notify işi 5 dakikada bir'
);
select is(
  (select command from cron.job where jobname = 'telefoncu-notify'),
  'select public._call_notify()',
  'iş _call_notify() çağırır'
);
select is((select count(*)::int from cron.job where jobname = 'telefoncu-notify'), 1, 'iş tek kez tanımlı');

-- ---------------------------------------------------------------------------
-- ACL
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public._call_notify()', 'EXECUTE'), 'anon _call_notify çağıramaz');
select ok(not has_function_privilege('authenticated', 'public._call_notify()', 'EXECUTE'), 'authenticated _call_notify çağıramaz');
select ok(not has_function_privilege('service_role', 'public._call_notify()', 'EXECUTE'), 'service_role _call_notify çağıramaz');
select ok((select prosecdef from pg_proc where oid = 'public._call_notify()'::regprocedure), 'security definer');

-- ---------------------------------------------------------------------------
-- Sır yokken istek yok
-- ---------------------------------------------------------------------------
create temp table q0 as select count(*)::int n from net.http_request_queue;
select is(public._call_notify(), null::bigint, 'sır yokken null döner');
select is((select count(*)::int from net.http_request_queue), (select n from q0), 'sır yokken istek kuyruğa girmez');

-- Yalnız biri tanımlıyken de istek yok
select vault.create_secret('https://ornek-test.invalid/', 'app_url');
select is(public._call_notify(), null::bigint, 'cron_secret yokken null döner');

-- İkisi tanımlıyken tek POST kuyruğa girer (işlem geri alınır; istek gönderilmez)
select vault.create_secret('test-sir-degeri', 'cron_secret');
select isnt(public._call_notify(), null::bigint, 'sırlar varken istek kimliği döner');
select is(
  (select url from net.http_request_queue order by id desc limit 1),
  'https://ornek-test.invalid/api/cron/notify',
  'adres sondaki eğik çizgi temizlenerek kurulur'
);
select is(
  (select method || ' ' || (headers ->> 'Authorization') from net.http_request_queue order by id desc limit 1),
  'POST Bearer test-sir-degeri',
  'POST ve Bearer başlığı'
);

select * from finish();
rollback;
