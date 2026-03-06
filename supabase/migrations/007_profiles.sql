-- Profiles: link auth users to role and consultant
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','user')),
  consultant_id uuid references public.consultants(id) on delete set null
);

-- Backfill existing auth users as admin (run before trigger so they get admin)
insert into public.profiles (id, role)
select id, 'admin' from auth.users
on conflict (id) do nothing;

-- New signups get role 'user' by default
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

-- Users can read own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Admins can read all profiles
create policy "Admins can read all profiles"
  on public.profiles for select
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

-- Users can update own profile (cannot change role to admin)
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()));

-- Admins can update any profile
create policy "Admins can update all profiles"
  on public.profiles for update
  using ((select role from public.profiles where id = auth.uid()) = 'admin');

-- Only admins can insert (e.g. when linking consultant to user)
create policy "Admins can insert profiles"
  on public.profiles for insert
  with check ((select role from public.profiles where id = auth.uid()) = 'admin');
