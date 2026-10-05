-- Kullanıcı silme: yönetici pasif bir çalışanı kalıcı siler (giriş hesabı + e-posta kaldırılır).
-- Geçmiş kayıtlar (aramalar, hareketler, audit) bozulmasın diye üye satırı "Silinmiş kullanıcı" olarak kalır.

-- Giriş hesabı silinince üyelik satırı düşmez, user_id boşalır.
alter table public.members alter column user_id drop not null;
alter table public.members drop constraint members_user_id_fkey;
alter table public.members
  add constraint members_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- Üyeyi anonimleştirir ve silinecek giriş hesabının kimliğini döndürür (hesabı sunucu action'ı admin API ile siler).
create or replace function public.anonymize_member(p_member uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members := public.current_member();
  t public.members;
begin
  if m.role <> 'manager' then
    raise exception 'Bu işlem için yönetici olmalısınız.' using errcode = '42501';
  end if;
  select * into t from public.members where id = p_member and tenant_id = m.tenant_id for update;
  if not found then
    raise exception 'Çalışan bulunamadı.' using errcode = '22023';
  end if;
  if t.id = m.id then
    raise exception 'Kendi hesabınızı silemezsiniz. Başka bir yöneticiden isteyin.' using errcode = '22023';
  end if;
  if t.is_active then
    raise exception 'Silmeden önce çalışanı pasifleştirin.' using errcode = '22023';
  end if;
  if t.user_id is null then
    raise exception 'Bu çalışan zaten silinmiş.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.customers
    where tenant_id = t.tenant_id and assigned_to = t.id and call_status in ('pending', 'retry')
  ) then
    raise exception 'Çalışanın açık müşterileri var. Önce Yönetim ekranından başka bir çalışana devredin.'
      using errcode = '22023';
  end if;

  update public.members
  set full_name = 'Silinmiş kullanıcı',
      role = 'agent',
      permissions = '{}'::jsonb,
      pin_hash = null,
      pin_failed = 0,
      locked_at = null,
      telegram_chat_id = null,
      telegram_linked_at = null,
      accent_color = null
  where id = t.id;

  perform public._audit(m.tenant_id, m.id, 'member_deleted', 'member', t.id, '{}'::jsonb);
  return t.user_id;
end;
$$;

revoke execute on function public.anonymize_member(uuid) from public, anon;
grant execute on function public.anonymize_member(uuid) to authenticated;
