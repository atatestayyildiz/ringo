-- Marka logosu depolama: herkese açık okunur bucket, yazma yalnız yönetici ve yalnız kendi kiracı öneki.
-- Yol sözleşmesi: <tenant_id>/<dosya>. Tür ve boyut bucket seviyesinde de sınırlıdır (SVG yok: XSS riski).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 524288,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- Okuma: kamu URL politikasız çalışır (public bucket). Listeleme/silme için yalnız yönetici, yalnız kendi öneki.
create policy brand_logos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
  );

create policy brand_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
  );

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
  );

create policy brand_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.auth_is_manager()
    and (storage.foldername(name))[1] = public.auth_tenant_id()::text
  );
