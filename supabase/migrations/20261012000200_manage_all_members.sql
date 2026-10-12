-- 1) Huni aşaması, randevu zamanı ve serbest not: mağazadaki tüm aktif kullanıcılar (kullanıcı kararı 2026-10-12).
--    Sahiplik/rol ayrımı yok; kiracı sınırı ve aktif üyelik korunur. log_call bugünkü listeye bağlı kalır.
--    _can_manage'ı kullanan set_pipeline_stage, set_appointment, add_customer_note değişmeden yeni kurala geçer.
-- 2) _open_claim_count: son sonucu boş (NULL) tekrar müşterisi sınırdan düşüyordu
--    (NULL in (...) -> NULL, not NULL -> NULL). Yalnız son sonucu Açmadı/Meşgul olan tekrar sayılmaz.

create or replace function public._can_manage(m public.members, c public.customers)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(m.id is not null and m.is_active and c.tenant_id = m.tenant_id, false)
$$;

revoke execute on function public._can_manage(public.members, public.customers) from public, anon, authenticated;

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
    and not (c.call_status = 'retry' and coalesce(c.last_outcome, '') in ('no_answer', 'busy'))
$$;

revoke execute on function public._open_claim_count(uuid, uuid) from public, anon, authenticated, service_role;
