-- RLS (spec §7). Ortak koşul: tenant_id = auth_tenant_id().
-- Ajan görünürlüğü spec §4'e göre sıkı: manager, view_all_customers veya
-- (assigned_to = kendisi VE bugün kendisine atanmış).

alter table public.tenants enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.members enable row level security;
alter table public.customers enable row level security;
alter table public.daily_assignments enable row level security;
alter table public.call_attempts enable row level security;
alter table public.pipeline_events enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- tenants: select üyeler, update manager. (insert/delete yalnız service role.)
-- ---------------------------------------------------------------------------
create policy tenants_select on public.tenants
  for select to authenticated
  using (id = (select public.auth_tenant_id()));

create policy tenants_update on public.tenants
  for update to authenticated
  using (id = (select public.auth_tenant_id()) and (select public.auth_is_manager()))
  with check (id = (select public.auth_tenant_id()));

-- ---------------------------------------------------------------------------
-- tenant_settings: select üyeler, update/insert manager. (delete yok: ayar satırı zorunlu.)
-- ---------------------------------------------------------------------------
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()));

create policy tenant_settings_insert on public.tenant_settings
  for insert to authenticated
  with check (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()));

create policy tenant_settings_update on public.tenant_settings
  for update to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()))
  with check (tenant_id = (select public.auth_tenant_id()));

-- ---------------------------------------------------------------------------
-- members: select üyeler, yazma manager.
-- ---------------------------------------------------------------------------
create policy members_select on public.members
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()));

create policy members_insert on public.members
  for insert to authenticated
  with check (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()));

create policy members_update on public.members
  for update to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()))
  with check (tenant_id = (select public.auth_tenant_id()));

create policy members_delete on public.members
  for delete to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()));

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create policy customers_select on public.customers
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (
      (select public.auth_is_manager())
      or (select public.auth_has_perm('view_all_customers'))
      or (assigned_to = (select public.auth_member_id()) and public.auth_assigned_today(id))
    )
  );

create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    tenant_id = (select public.auth_tenant_id())
    and ((select public.auth_is_manager()) or (select public.auth_has_perm('import_customers')))
  );

create policy customers_update on public.customers
  for update to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()))
  with check (tenant_id = (select public.auth_tenant_id()));

create policy customers_delete on public.customers
  for delete to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and ((select public.auth_is_manager()) or (select public.auth_has_perm('delete_customers')))
  );

-- ---------------------------------------------------------------------------
-- daily_assignments: select; yazma yalnız fonksiyonlar
-- ---------------------------------------------------------------------------
create policy daily_assignments_select on public.daily_assignments
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (
      (select public.auth_is_manager())
      or (select public.auth_has_perm('view_reports'))
      or member_id = (select public.auth_member_id())
    )
  );

-- ---------------------------------------------------------------------------
-- call_attempts, pipeline_events: ilgili müşteriyi görebilen
-- ---------------------------------------------------------------------------
create policy call_attempts_select on public.call_attempts
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and public.auth_can_view_customer(customer_id));

create policy pipeline_events_select on public.pipeline_events
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and public.auth_can_view_customer(customer_id));

-- ---------------------------------------------------------------------------
-- audit_log: yalnız manager okur
-- ---------------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_is_manager()));

-- ---------------------------------------------------------------------------
-- Tablo yetkileri (RLS'e ek savunma)
-- TRUNCATE/REFERENCES/TRIGGER RLS'e tabi değildir, istemci rollerinden alınır.
-- anon hiçbir tabloya erişemez (giriş ekranı markası login_branding() ile gelir).
-- ---------------------------------------------------------------------------
revoke all on table
  public.tenants, public.tenant_settings, public.members, public.customers,
  public.daily_assignments, public.call_attempts, public.pipeline_events, public.audit_log
from anon;

revoke truncate, references, trigger on table
  public.tenants, public.tenant_settings, public.members, public.customers,
  public.daily_assignments, public.call_attempts, public.pipeline_events, public.audit_log
from authenticated;

revoke insert, delete on table public.tenants from authenticated;
revoke delete on table public.tenant_settings from authenticated;
revoke insert, update, delete on table
  public.daily_assignments, public.call_attempts, public.pipeline_events, public.audit_log
from authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;
