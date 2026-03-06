-- Project cost estimation schema
-- Clients -> Projects -> Phases -> Activities -> Activity Assignments (consultant + hours)
-- Consultants have cost_per_hour and charge_out_rate

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Consultants (used across activities)
create table public.consultants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  cost_per_hour numeric(12, 2) not null default 0,
  charge_out_rate numeric(12, 2) not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Clients
create table public.clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Projects (belong to client)
create table public.projects (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Phases (belong to project)
create table public.phases (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Activities (belong to phase)
create table public.activities (
  id uuid primary key default uuid_generate_v4(),
  phase_id uuid not null references public.phases(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Activity assignments: consultant + hours per activity (multiple consultants per activity)
create table public.activity_assignments (
  id uuid primary key default uuid_generate_v4(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  consultant_id uuid not null references public.consultants(id) on delete restrict,
  hours numeric(10, 2) not null check (hours >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(activity_id, consultant_id)
);

-- Indexes for common lookups
create index idx_projects_client_id on public.projects(client_id);
create index idx_phases_project_id on public.phases(project_id);
create index idx_activities_phase_id on public.activities(phase_id);
create index idx_activity_assignments_activity_id on public.activity_assignments(activity_id);
create index idx_activity_assignments_consultant_id on public.activity_assignments(consultant_id);

-- RLS: enable and allow authenticated users full access (scope later by user/org if needed)
alter table public.consultants enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.phases enable row level security;
alter table public.activities enable row level security;
alter table public.activity_assignments enable row level security;

create policy "Allow all for authenticated users on consultants"
  on public.consultants for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users on clients"
  on public.clients for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users on projects"
  on public.projects for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users on phases"
  on public.phases for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users on activities"
  on public.activities for all to authenticated using (true) with check (true);

create policy "Allow all for authenticated users on activity_assignments"
  on public.activity_assignments for all to authenticated using (true) with check (true);

-- Optional: allow anonymous read for demo (remove in production)
-- create policy "Allow read for anon on clients" on public.clients for select to anon using (true);
-- etc.
