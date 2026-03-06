-- Time entries for timesheet (one row per consultant/activity/project/date)
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  entry_date date not null,
  hours numeric(10, 2) not null check (hours >= 0),
  notes text,
  created_at timestamptz default now()
);

create unique index time_entries_consultant_project_activity_date_key
  on public.time_entries (consultant_id, project_id, activity_id, entry_date);

create index idx_time_entries_project_date on public.time_entries(project_id, entry_date);
create index idx_time_entries_consultant_date on public.time_entries(consultant_id, entry_date);

alter table public.time_entries enable row level security;

-- Helper: my consultant_id from profile (null if no profile or no consultant)
create or replace function public.my_consultant_id()
returns uuid as $$
  select consultant_id from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- Helper: am I admin?
create or replace function public.is_admin()
returns boolean as $$
  select (select role from public.profiles where id = auth.uid()) = 'admin';
$$ language sql stable security definer;

-- Select: admin sees all; user sees only own (by consultant_id)
create policy "Admins can select all time_entries"
  on public.time_entries for select
  using (public.is_admin());

create policy "Users can select own time_entries"
  on public.time_entries for select
  using (consultant_id = public.my_consultant_id());

-- Insert: admin any; user only own consultant_id
create policy "Admins can insert any time_entries"
  on public.time_entries for insert
  with check (public.is_admin());

create policy "Users can insert own time_entries"
  on public.time_entries for insert
  with check (consultant_id = public.my_consultant_id());

-- Update: admin any; user only own
create policy "Admins can update any time_entries"
  on public.time_entries for update
  using (public.is_admin());

create policy "Users can update own time_entries"
  on public.time_entries for update
  using (consultant_id = public.my_consultant_id());

-- Delete: admin any; user only own
create policy "Admins can delete any time_entries"
  on public.time_entries for delete
  using (public.is_admin());

create policy "Users can delete own time_entries"
  on public.time_entries for delete
  using (consultant_id = public.my_consultant_id());
