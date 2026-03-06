-- Admin: list auth users and link consultants to users (admin-only RPCs)

-- Returns id and email of all auth.users (admin only)
create or replace function public.get_auth_users()
returns table (id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_admin();
$$;

-- Links a consultant to an auth user (or unlinks if p_user_id is null). Admin only.
-- If p_user_id is set, any other consultant currently linked to that user is unlinked first.
create or replace function public.link_consultant_to_user(p_consultant_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can link consultants to users';
  end if;

  -- Unlink any other consultant that has this user_id (one user -> one consultant)
  if p_user_id is not null then
    update public.consultants set user_id = null where user_id = p_user_id and id != p_consultant_id;
  end if;

  update public.consultants
  set user_id = p_user_id, updated_at = now()
  where id = p_consultant_id;
end;
$$;

grant execute on function public.get_auth_users() to authenticated;
grant execute on function public.link_consultant_to_user(uuid, uuid) to authenticated;
