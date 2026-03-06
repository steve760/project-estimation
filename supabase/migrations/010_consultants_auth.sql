-- Consultants become the auth-linked entity: each consultant can have a login (user_id) and role (admin/user).
-- New auth users get a new consultant row with role 'user'. No separate profiles table.

-- Add auth link and role to consultants (nullable user_id for consultants who don't log in)
alter table public.consultants
  add column if not exists user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists role text not null default 'user' check (role in ('admin','user'));

-- Backfill from profiles: link existing consultants that have a profile pointing to them
update public.consultants c
set user_id = p.id, role = p.role
from public.profiles p
where p.consultant_id = c.id;

-- Backfill: create a consultant for each profile that had no consultant_id (auth user with no consultant yet)
insert into public.consultants (user_id, role, name, cost_per_hour, charge_out_rate)
select p.id, p.role,
  coalesce(
    nullif(trim((u.raw_user_meta_data->>'full_name')::text), ''),
    split_part(u.email, '@', 1),
    'User'
  ),
  0, 0
from public.profiles p
join auth.users u on u.id = p.id
where p.consultant_id is null
on conflict (user_id) do nothing;

-- Remove old profile trigger so new signups don't create profiles
drop trigger if exists on_auth_user_created on auth.users;

-- When a new auth user is created, create a consultant for them (default role 'user')
create or replace function public.handle_new_user_consultant()
returns trigger as $$
begin
  insert into public.consultants (user_id, role, name, cost_per_hour, charge_out_rate)
  values (
    new.id,
    'user',
    coalesce(
      nullif(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      split_part(new.email, '@', 1),
      'New User'
    ),
    0,
    0
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created_consultant
  after insert on auth.users
  for each row execute procedure public.handle_new_user_consultant();

-- RLS helpers: resolve current user's consultant id and admin flag from consultants (not profiles)
create or replace function public.my_consultant_id()
returns uuid as $$
  select id from public.consultants where user_id = auth.uid();
$$ language sql stable security definer;

create or replace function public.is_admin()
returns boolean as $$
  select (select role from public.consultants where user_id = auth.uid()) = 'admin';
$$ language sql stable security definer;

-- Drop profiles (policies then table)
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;
drop policy if exists "Admins can insert profiles" on public.profiles;
drop table if exists public.profiles;

-- Consultants RLS: allow users to update their own consultant row (e.g. name, rates)
create policy "Users can update own consultant"
  on public.consultants for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Keep existing "Allow all for authenticated" for select/insert so dropdowns and trigger work
-- (trigger runs as definer; authenticated users need read for lists)
