-- pg_cron: saatlik iş, distribution_hour'u gelen kiracıları dağıtır (spec §5, §6).
-- run_scheduled_distribution yerel saati (Europe/Istanbul) kendisi hesaplar; cron UTC çalışır.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'telefoncu-distribution') then
    perform cron.unschedule('telefoncu-distribution');
  end if;
end;
$$;

select cron.schedule(
  'telefoncu-distribution',
  '0 * * * *',
  $$select public.run_scheduled_distribution()$$
);
