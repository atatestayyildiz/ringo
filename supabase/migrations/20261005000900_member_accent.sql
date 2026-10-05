-- Kişisel arayüz vurgu rengi (2026-10-05). null = varsayılan
-- (yönetici: kiracı marka rengi, satışçı: nötr ton; karar arayüzde).
-- İstemci kolonu doğrudan yazamaz (members update grant'ı kolon bazlı, bu kolon eklenmez);
-- yalnız set_my_accent çağıranın kendi satırını günceller.
alter table public.members
  add column accent_color text null
  constraint members_accent_color_hex check (accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- Okuma: mevcut kolon bazlı select grant'ına yalnız bu kolon eklenir
grant select (accent_color) on table public.members to authenticated;

create or replace function public.set_my_accent(p_color text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
begin
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Geçersiz renk. Listeden bir renk seçin.' using errcode = '22023';
  end if;
  update public.members
  set accent_color = case when p_color is null then null else lower(p_color) end
  where id = m.id;
end;
$$;

revoke execute on function public.set_my_accent(text) from public, anon;
grant execute on function public.set_my_accent(text) to authenticated;
