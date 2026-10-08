-- Serbest havuzda "Sıradakini al" sınırı (claim_limit) yalnız bekleyen müşterileri sayar.
-- Eskiden listedeki vakti gelmiş tüm açık müşteriler (bekleyen + tekrar) sayılıyordu; "Açmadı" ve "Meşgul"
-- sonrası tekrar listesine düşenler de sınırı dolduruyor, çalışan yeni müşteri alamıyordu.
-- Şimdi sayılanlar: bekleyen (hiç aranmamış) ve geri arama zamanı gelmiş müşteri (Sonra ara).
-- Sayılmayanlar: son sonucu Açmadı ya da Meşgul olan tekrar müşterisi (listede kalır, aranmaya devam edilir).
-- Fonksiyonun imzası ve yetkileri aynı; claim_next ve claim_queue_status bu fonksiyonu kullanır.

create or replace function public._open_claim_count(p_tenant uuid, p_member uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.daily_assignments d
  join public.customers c on c.id = d.customer_id
  where d.tenant_id = p_tenant and d.day = public.tr_today() and d.member_id = p_member
    and c.call_status in ('pending', 'retry') and c.next_call_at <= now()
    and not (c.call_status = 'retry' and c.last_outcome in ('no_answer', 'busy'))
$$;

revoke execute on function public._open_claim_count(uuid, uuid) from public, anon, authenticated, service_role;
