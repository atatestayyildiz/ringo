-- Faz 2.5 inceleme düzeltmeleri (D4, D6)

-- D4: logo_url yalnız https ya da yerel geliştirme adresi (http://127.0.0.1 / localhost).
alter table public.tenant_settings drop constraint if exists tenant_settings_logo_url_check;
alter table public.tenant_settings add constraint tenant_settings_logo_url_check
  check (logo_url is null or logo_url ~* '^https://' or logo_url ~* '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/');

-- D6: logo yükleme adı sözleşmesi: <tenant_id>/logo-<uuid>.(png|jpg|webp), küçük harf.
-- Başka ad, büyük harf, başka uzantı ya da ek yol seviyesi reddedilir. Güncelleme (yeniden adlandırma) da aynı sözleşmeye bağlıdır.
drop policy if exists brand_logos_insert on storage.objects;
create policy brand_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and name ~ ('^' || public.auth_tenant_id()::text || '/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$')
  );

drop policy if exists brand_logos_update on storage.objects;
create policy brand_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
  )
  with check (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
    and name ~ ('^' || public.auth_tenant_id()::text || '/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$')
  );
