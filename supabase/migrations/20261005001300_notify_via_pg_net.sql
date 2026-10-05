-- Telegram bildirim zamanlayıcısı Vercel Cron yerine pg_cron + pg_net.
-- Vercel Hobby günde bir cron kabul eder; /api/cron/notify 5 dakikada bir buradan çağrılır.
-- Adres ve sır koda yazılmaz: Supabase Vault'tan okunur (vault.decrypted_secrets):
--   app_url     -> uygulama kök adresi (ör. https://ornek.vercel.app)
--   cron_secret -> Vercel'deki CRON_SECRET ile aynı değer
-- İkisinden biri yoksa (yerel geliştirme dahil) iş hiçbir istek yapmaz.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- _call_notify: iç fonksiyon, yalnız pg_cron (postgres) çağırır.
-- Döner: kuyruğa alınan pg_net istek kimliği; sır eksikse null.
-- ---------------------------------------------------------------------------
create or replace function public._call_notify()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_id bigint;
begin
  select btrim(s.decrypted_secret) into v_url
  from vault.decrypted_secrets s
  where s.name = 'app_url'
  order by s.created_at desc
  limit 1;

  select btrim(s.decrypted_secret) into v_secret
  from vault.decrypted_secrets s
  where s.name = 'cron_secret'
  order by s.created_at desc
  limit 1;

  if v_url is null or v_url !~* '^https?://[^\s]+$' or v_secret is null or v_secret = '' then
    return null;
  end if;

  select net.http_post(
    url := regexp_replace(v_url, '/+$', '') || '/api/cron/notify',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$$;

revoke execute on function public._call_notify() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pg_cron: 5 dakikada bir
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'telefoncu-notify') then
    perform cron.unschedule('telefoncu-notify');
  end if;
end;
$$;

select cron.schedule(
  'telefoncu-notify',
  '*/5 * * * *',
  $$select public._call_notify()$$
);
